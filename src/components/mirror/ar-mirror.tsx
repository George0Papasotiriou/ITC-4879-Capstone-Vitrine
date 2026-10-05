"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AR Mirror: the front camera as a mirror, with a hat, earrings or a necklace drawn on the face at true size, following it as it moves.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadFaceTracker, type FaceFrame, type FaceTracker } from "@/components/mirror/face-tracker";
import { Button, ButtonLink } from "@/components/ui/button";
import type { Point2 } from "@/lib/vision/camera";
import { cutoutFromWhite } from "@/lib/vision/cutout";
import { applyMatrix } from "@/lib/vision/harmonize";
import { add3, scale3, type Vec3 } from "@/lib/vision/linalg";
import { accelerationOf, ANCHORS_MM, earTurnedAway, hangingCard, hatCard, HEAD_WIDTH_MM, hiddenBehindFace, inPoseFrame, NECKLACE_RISE_MM, neckPoint, Pendulum, projectCard } from "@/lib/vision/mirror/anchors";
import { CANONICAL_FACE_MM, FACE_OUTLINE, IRISES, LEFT_EYE_OUTLINE, RIGHT_EYE_OUTLINE } from "@/lib/vision/mirror/face-model";
import { faceScale, irisDiameterPx } from "@/lib/vision/mirror/iris";
import { faceLight, pieceGains, scleraPixels } from "@/lib/vision/mirror/light";
import { earringHeightMm, hatWidthFactor, NECKLACE_WIDTH_MM, oneEarring, type MirrorKind } from "@/lib/vision/mirror/pieces";
import { frameIntrinsics, headAngles, projectCamera, solveHeadPose, toCamera, type HeadPose, type Intrinsics } from "@/lib/vision/mirror/pose";
import { OneEuroFilter, PoseSmoother } from "@/lib/vision/mirror/smoothing";
import { inflateTriangle, warpTriangles } from "@/lib/vision/mirror/warp";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/065. Everything happens on the shopper's device: the camera's
 * frames go to the landmarker in this tab (face-tracker.ts), the pose and
 * the drawing are computed here, and a picture is saved only when asked, to
 * the shopper's own downloads. Nothing is sent, so nothing is kept.
 *
 * Each frame: landmarks → the head's pose (pose.ts, all 468 points, from the
 * last frame's pose) → smoothed (One-Euro) → the face's own scale from its
 * irises (smoothed slowly) → the piece's card in 3D (anchors.ts) → projected
 * and drawn by triangles (warp.ts). The light on the face is read from the
 * whites of the eyes every half second and the piece's photograph is tinted
 * to match (light.ts).
 */

export type MirrorPiece = { slug: string; title: string; kind: MirrorKind; image: string | null };

type Phase = "intro" | "starting" | "loading" | "live" | "error";
type Problem = "camera_denied" | "no_camera" | "not_installed" | "integrity" | "no_webassembly" | "failed";

/** A piece's photograph, cut out of its white ground and ready to draw; `tinted` is the same, lit like the face. */
type Prepared = { slug: string; image: HTMLCanvasElement; tinted: HTMLCanvasElement; aspect: number; gains: [number, number, number] };

const FIELD_OF_VIEW = 63;
/** How often the light is read again, in frames. */
const LIGHT_EVERY = 15;
/** Missed frames before the pose is forgotten (the face left the picture). */
const LOST_AFTER = 12;

/** The photograph, cut out of its white ground; an earring is cut down to one of the pair, a necklace fades where it would pass behind the neck. */
async function preparePiece(piece: MirrorPiece): Promise<Prepared | null> {
  if (piece.image === null) return null;
  const image = new Image();
  image.decoding = "async";
  image.src = piece.image;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const longest = 640;
  const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(image, 0, 0, width, height);
  // Jewellery has openings (a hoop, an open heart): the studio white inside them is background too.
  const cutout = cutoutFromWhite(ctx.getImageData(0, 0, width, height).data, width, height, { openings: piece.kind !== "HAT" });
  ctx.putImageData(new ImageData(cutout.rgba, width, height), 0, 0);
  let box = cutout.box;
  if (piece.kind === "EARRING") {
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < width * height; i += 1) alpha[i] = cutout.rgba[i * 4 + 3]!;
    box = oneEarring(alpha, width, height) ?? box;
  }
  if (box.width < 2 || box.height < 2) return null;
  const crop = document.createElement("canvas");
  crop.width = box.width;
  crop.height = box.height;
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  if (cropCtx === null) return null;
  cropCtx.drawImage(work, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  if (piece.kind === "NECKLACE") {
    // The chain goes round the back of the neck: its top fifth fades out rather than lying across the jaw.
    const fade = cropCtx.createLinearGradient(0, 0, 0, box.height * 0.22);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    cropCtx.globalCompositeOperation = "destination-in";
    cropCtx.fillStyle = fade;
    cropCtx.fillRect(0, 0, box.width, box.height);
    cropCtx.globalCompositeOperation = "source-over";
  }
  const tinted = document.createElement("canvas");
  tinted.width = box.width;
  tinted.height = box.height;
  tinted.getContext("2d")?.drawImage(crop, 0, 0);
  return { slug: piece.slug, image: crop, tinted, aspect: box.height / box.width, gains: [1, 1, 1] };
}

/** Re-tints a prepared piece when the light has changed by more than a few percent. */
function retint(prepared: Prepared, gains: [number, number, number]): void {
  if (gains.every((gain, index) => Math.abs(gain - prepared.gains[index]!) < 0.04)) return;
  const ctx = prepared.tinted.getContext("2d", { willReadFrequently: true });
  const source = prepared.image.getContext("2d", { willReadFrequently: true });
  if (ctx === null || source === null) return;
  const pixels = source.getImageData(0, 0, prepared.image.width, prepared.image.height);
  applyMatrix(pixels.data, gains);
  ctx.clearRect(0, 0, prepared.tinted.width, prepared.tinted.height);
  ctx.putImageData(pixels, 0, 0);
  prepared.gains = gains;
}

/** Draws a prepared piece onto a quadrilateral (top left, top right, bottom right, bottom left), mirrored left to right when asked. */
function drawQuad(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, quad: [Point2, Point2, Point2, Point2], flip = false): boolean {
  const corners: [Point2, Point2, Point2, Point2] = flip ? [quad[1], quad[0], quad[3], quad[2]] : quad;
  const triangles = warpTriangles(source.width, source.height, corners, 4);
  if (triangles === null) return false;
  for (const triangle of triangles) {
    const [p0, p1, p2] = inflateTriangle(triangle.to);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(...triangle.transform);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
  return true;
}

export function ArMirror({ pieces, focus }: { pieces: MirrorPiece[]; focus: string | null }) {
  const t = useTranslations("mirror");
  const [phase, setPhase] = useState<Phase>("intro");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [progress, setProgress] = useState(0);
  const [tracking, setTracking] = useState<"searching" | "tracking">("searching");
  const [current, setCurrent] = useState<string | null>(focus ?? pieces[0]?.slug ?? null);
  const [kindFilter, setKindFilter] = useState<MirrorKind | "all">("all");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);
  const frameRef = useRef<number | null>(null);
  const preparedRef = useRef<Map<string, Prepared | null>>(new Map());
  // The frame loop reads the chosen piece from a ref, so changing it never restarts the loop.
  const currentRef = useRef<string | null>(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const piece = useMemo(() => pieces.find((entry) => entry.slug === current) ?? null, [pieces, current]);
  const shown = kindFilter === "all" ? pieces : pieces.filter((entry) => entry.kind === kindFilter);
  const kinds = useMemo(() => [...new Set(pieces.map((entry) => entry.kind))], [pieces]);

  // The piece's photograph is prepared as soon as it is chosen, while the camera starts.
  useEffect(() => {
    if (piece === null || preparedRef.current.has(piece.slug)) return;
    preparedRef.current.set(piece.slug, null);
    void preparePiece(piece).then((prepared) => preparedRef.current.set(piece.slug, prepared));
  }, [piece]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackerRef.current?.close();
    trackerRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  /** The frame loop: track, solve, smooth, draw. */
  const run = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const tracker = trackerRef.current;
    if (video === null || canvas === null || tracker === null) return;
    const ctx = canvas.getContext("2d");
    const lightCanvas = document.createElement("canvas");
    const lightCtx = lightCanvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null || lightCtx === null) return;
    const smoother = new PoseSmoother();
    const scaleFilter = new OneEuroFilter({ minCutoff: 0.2, beta: 0 });
    const pendulums = [new Pendulum(0.02), new Pendulum(0.02)];
    const lobes: [number, Vec3][][] = [[], []];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
    let previous: HeadPose | null = null;
    let missed = 0;
    let scale = 1;
    let frames = 0;
    let lastVideoTime = -1;
    let gains: [number, number, number] = [1, 1, 1];
    let lastTime = performance.now();

    const readLight = (frame: FaceFrame) => {
      const width = 320;
      const height = Math.round((frame.height / frame.width) * width);
      lightCanvas.width = width;
      lightCanvas.height = height;
      lightCtx.drawImage(video, 0, 0, width, height);
      const pixels = lightCtx.getImageData(0, 0, width, height).data;
      const k = width / frame.width;
      const scaled = (index: number): Point2 => [frame.landmarks[index]![0] * k, frame.landmarks[index]![1] * k];
      const samples = [RIGHT_EYE_OUTLINE, LEFT_EYE_OUTLINE].flatMap((outline, index) => {
        const iris = IRISES[index]!;
        const diameter = irisDiameterPx(frame.landmarks, iris);
        if (diameter === null) return [];
        return scleraPixels(pixels, width, height, outline.map(scaled), { centre: scaled(iris.centre), radius: (diameter * k) / 2 });
      });
      const light = faceLight(samples);
      if (light !== null) gains = pieceGains(light);
    };

    const draw = (pose: HeadPose, K: Intrinsics, dt: number, frame: FaceFrame): number => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const active = pieces.find((entry) => entry.slug === currentRef.current);
      const prepared = active === undefined ? null : (preparedRef.current.get(active.slug) ?? null);
      if (active === undefined || prepared === null) return 0;
      retint(prepared, gains);
      const source = prepared.tinted;
      if (active.kind === "HAT") {
        const width = HEAD_WIDTH_MM * hatWidthFactor(active.title);
        const quad = projectCard(K, hatCard(pose, width, width * prepared.aspect));
        return quad !== null && drawQuad(ctx, source, quad) ? 1 : 0;
      }
      if (active.kind === "NECKLACE") {
        const width = inPoseFrame(NECKLACE_WIDTH_MM, scale);
        const top = add3(neckPoint(pose), [0, -NECKLACE_RISE_MM, 0]);
        const roll = (headAngles(pose.R).roll * Math.PI) / 180;
        const quad = projectCard(K, hangingCard(top, width, width * prepared.aspect, 0.3 * roll));
        return quad !== null && drawQuad(ctx, source, quad) ? 1 : 0;
      }
      // Earrings: one at each earlobe the head does not hide, each swinging on its own.
      const { mm, style } = earringHeightMm(active.title);
      const height = inPoseFrame(mm, scale);
      const width = height / prepared.aspect;
      let drawn = 0;
      [ANCHORS_MM.rightEarlobe, ANCHORS_MM.leftEarlobe].forEach((anchor, side) => {
        const lobe = toCamera(pose, anchor);
        const history = lobes[side]!;
        history.push([performance.now(), scale3(lobe, scale)]);
        if (history.length > 3) history.shift();
        const pendulum = pendulums[side]!;
        let angle = 0;
        if (style !== "stud" && !reduced && history.length === 3) {
          const [[t0, a], [t1, b], [t2, c]] = history as [[number, Vec3], [number, Vec3], [number, Vec3]];
          const [ax, ay] = accelerationOf([a, b, c], (t1 - t0) / 1000, (t2 - t1) / 1000);
          angle = pendulum.step(dt, ax, ay);
        }
        const lobePoint = projectCamera(K, lobe);
        if (lobePoint === null || hiddenBehindFace(lobePoint, FACE_OUTLINE.map((index) => frame.landmarks[index]!), earTurnedAway(pose, side === 0 ? "right" : "left"))) return;
        // A stud sits on the lobe; anything that hangs hangs from it.
        const top: Vec3 = style === "stud" ? add3(lobe, [0, -height / 2, 0]) : lobe;
        const quad = projectCard(K, hangingCard(top, width, height, angle));
        // The left ear wears the mirror image, as a pair is made.
        if (quad !== null && drawQuad(ctx, source, quad, side === 1)) drawn += 1;
      });
      return drawn;
    };

    const step = () => {
      frameRef.current = requestAnimationFrame(step);
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const frame = tracker.detect(video, now);
      if (frame === null) {
        missed += 1;
        if (missed === LOST_AFTER) {
          previous = null;
          smoother.reset();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          setTracking("searching");
          stageRef.current?.setAttribute("data-mirror-drawn", "0");
        }
        return;
      }
      if (missed >= LOST_AFTER || frames === 0) setTracking("tracking");
      missed = 0;
      frames += 1;
      const K = frameIntrinsics(frame.width, frame.height, FIELD_OF_VIEW);
      const solved = solveHeadPose(frame.landmarks.slice(0, CANONICAL_FACE_MM.length), CANONICAL_FACE_MM, K, previous);
      if (solved === null) return;
      previous = solved;
      const pose = smoother.smooth(solved, now / 1000);
      const measured = faceScale(frame.landmarks, K, solved);
      if (measured !== null) scale = scaleFilter.filter(measured, now / 1000);
      if (frames % LIGHT_EVERY === 1) readLight(frame);
      const drawn = draw(pose, K, dt, frame);
      const stage = stageRef.current;
      if (stage !== null) {
        stage.setAttribute("data-mirror-drawn", String(drawn));
        stage.setAttribute("data-mirror-yaw", String(Math.round(headAngles(pose.R).yaw)));
        stage.setAttribute("data-mirror-scale", scale.toFixed(2));
      }
    };
    frameRef.current = requestAnimationFrame(step);
  }, [pieces]);

  const start = useCallback(async () => {
    setProblem(null);
    if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
      setProblem("no_camera");
      setPhase("error");
      return;
    }
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      stop();
      setProblem(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "camera_denied" : "no_camera");
      setPhase("error");
      return;
    }
    setPhase("loading");
    const loaded = await loadFaceTracker((received, total) => setProgress(total > 0 ? Math.min(1, received / total) : 0));
    if (!loaded.ok) {
      stop();
      setProblem(loaded.reason);
      setPhase("error");
      return;
    }
    trackerRef.current = loaded.tracker;
    setTracking("searching");
    setPhase("live");
    run();
  }, [run, stop]);

  const end = () => {
    stop();
    setPhase("intro");
  };

  /** A picture of the mirror as seen (the video and the piece, mirrored), saved to the shopper's own downloads. */
  const save = () => {
    const video = videoRef.current;
    const overlay = canvasRef.current;
    if (video === null || overlay === null || video.videoWidth === 0) return;
    const picture = document.createElement("canvas");
    picture.width = video.videoWidth;
    picture.height = video.videoHeight;
    const ctx = picture.getContext("2d");
    if (ctx === null) return;
    ctx.translate(picture.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    picture.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vitrine-mirror-${piece?.slug ?? "picture"}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  };

  const sizeNote = (() => {
    if (piece === null) return null;
    if (piece.kind === "HAT") return t("size.hat");
    if (piece.kind === "NECKLACE") return t("size.necklace", { mm: NECKLACE_WIDTH_MM });
    const earring = earringHeightMm(piece.title);
    return earring.from === "title" ? t("size.earringTitle", { mm: Math.round(earring.mm) }) : t("size.earringTypical", { mm: earring.mm, style: t(`styles.${earring.style}`) });
  })();

  const live = phase === "live" || phase === "loading" || phase === "starting";

  return (
    <div className="mt-8 flex flex-col gap-8" data-agent-id="mirror:room" data-mirror-phase={phase}>
      <section aria-labelledby="mirror-stage" className="flex flex-col gap-4">
        <h2 id="mirror-stage" className="sr-only">
          {t("stageTitle")}
        </h2>
        <div
          ref={stageRef}
          className={cn("bg-dusk rounded-plinth relative mx-auto w-full max-w-[880px] overflow-hidden", live ? "aspect-[4/3] sm:aspect-video" : "hidden")}
          data-agent-id="mirror:stage"
          data-mirror-tracking={tracking}
          data-mirror-drawn="0"
        >
          {/* The shopper's own camera, shown as a mirror; described by the status line, not read out. */}
          <video ref={videoRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" playsInline muted aria-hidden="true" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover" aria-hidden="true" data-agent-id="mirror:overlay" />
          <p role="status" aria-live="polite" className="bg-dusk/70 text-glass absolute top-3 left-3 rounded-full px-3 py-1 text-sm" data-agent-id="mirror:status">
            {phase === "starting" ? t("status.starting") : phase === "loading" ? t("status.loading", { percent: Math.round(progress * 100) }) : tracking === "tracking" ? t("status.tracking") : t("status.searching")}
          </p>
        </div>

        {phase === "intro" || phase === "error" ? (
          <div className="border-hairline rounded-plinth flex max-w-[70ch] flex-col gap-3 border p-5" data-agent-id="mirror:intro">
            <p className="text-sm">{t("intro")}</p>
            <ul className="text-slate flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>{t("promises.device")}</li>
              <li>{t("promises.nothingSent")}</li>
              <li>{t("promises.download")}</li>
            </ul>
            {problem !== null ? (
              <p role="alert" className="text-danger text-sm" data-agent-id="mirror:problem">
                {t(`problems.${problem}`)}
              </p>
            ) : null}
            <div>
              <Button onClick={() => void start()} disabled={pieces.length === 0} data-agent-id="mirror:start">
                {problem === null ? t("start") : t("tryAgain")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3" data-agent-id="mirror:controls">
            <Button onClick={save} disabled={phase !== "live"} data-agent-id="mirror:save">
              {t("save")}
            </Button>
            <Button variant="secondary" onClick={end} data-agent-id="mirror:stop">
              {t("stop")}
            </Button>
            {piece === null ? null : (
              <ButtonLink variant="secondary" href={`/p/${piece.slug}`} data-agent-id="mirror:view-piece">
                {t("viewPiece")}
              </ButtonLink>
            )}
          </div>
        )}
        {piece === null ? null : (
          <p className="text-slate max-w-[70ch] text-xs" data-agent-id="mirror:size-note">
            {t("photoNote")} {sizeNote}
          </p>
        )}
      </section>

      <section aria-labelledby="mirror-pieces" className="flex flex-col gap-4">
        <h2 id="mirror-pieces" className="font-display text-xl">
          {t("piecesTitle")}
        </h2>
        {kinds.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
            {(["all", ...kinds] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kindFilter === kind}
                onClick={() => setKindFilter(kind)}
                className={cn("rounded-plinth border-hairline min-h-11 border px-3 text-sm", kindFilter === kind ? "bg-dusk text-glass border-dusk" : "bg-white")}
                data-agent-id={`mirror:filter:${kind}`}
              >
                {t(`kinds.${kind}`)}
              </button>
            ))}
          </div>
        ) : null}
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6" data-agent-id="mirror:pieces">
          {shown.map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                aria-pressed={entry.slug === current}
                onClick={() => setCurrent(entry.slug)}
                className={cn("border-hairline rounded-plinth flex w-full flex-col gap-2 border p-2 text-left", entry.slug === current && "border-dusk ring-dusk ring-1")}
                data-agent-id={`mirror:piece:${entry.slug}`}
              >
                <span className="bg-plinth rounded-plinth relative block aspect-square overflow-hidden">
                  {entry.image === null ? null : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.image} alt="" width={200} height={200} className="h-full w-full object-contain mix-blend-multiply" loading="lazy" />
                  )}
                </span>
                <span className="line-clamp-2 text-xs">{entry.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
