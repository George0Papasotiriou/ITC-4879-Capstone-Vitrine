"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Room planner: photo upload, sheet corner marking, pose recovery and product placement.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { loadDepthModel, sampleDepthSource, type DepthSource } from "@/components/room/depth-estimator";
import { drawScene, type Cutout } from "@/components/room/draw-scene";
import { drawSampleRoom, SAMPLE_HEIGHT, SAMPLE_WIDTH, sampleRoomGeometry } from "@/components/room/sample-room";
import { Button } from "@/components/ui/button";
import { seededRandom } from "@/lib/reco/simulate";
import { defaultSpot, floorFromDepth, judgeFloor, type DepthMap, type FloorFromDepth } from "@/lib/vision/depth";
import {
  A4_SHEET,
  cameraCentre,
  DEFAULT_FOV_DEGREES,
  floorPointAt,
  focalFromFov,
  intrinsics,
  projectPoint,
  solveSheet,
  type Placement,
  type Point2,
  type Sheet,
} from "@/lib/vision/camera";
import { refineCorners, toGray, type GrayImage } from "@/lib/vision/corners";
import { cutoutFromWhite } from "@/lib/vision/cutout";
import { readCameraExif } from "@/lib/vision/exif";
import { cn } from "@/lib/ui/cn";

/**
 * "See it in your room" (docs/PLAN.md Phase 10, A4): photo, four taps on a sheet
 * of paper, product at true scale. Everything happens in this component, in the
 * browser; the photo is never uploaded.
 *
 * The geometry is src/lib/vision: taps are snapped to the sheet's edges
 * (corners.ts), the camera is recovered from them (camera.ts), and the product
 * is drawn with that camera (draw-scene.ts).
 */

export type PlaceableProduct = {
  title: string;
  dims: { w: number; d: number; h: number };
  mode: "stand" | "lie";
  imageSrc: string | null;
};

type Photo = { canvas: HTMLCanvasElement; width: number; height: number; gray: GrayImage; focal35: number | null; sample: boolean };
type Stage = "photo" | "corners" | "scan" | "place";
/** The two ways to give the photograph a size: the sheet of paper, or a depth model (ADR-014). */
type Method = "paper" | "depth";
type Measured = { map: DepthMap; metric: boolean; ms: number };
type ScanFailure = "not_installed" | "unsupported_output" | "no_webassembly" | "failed";

/** Working resolution: enough for sub-pixel corners, small enough for a phone's memory. */
const MAX_SIDE = 2048;
const SHEETS: Record<"a4" | "letter", Sheet> = { a4: A4_SHEET, letter: { width: 0.2159, length: 0.2794 } };
const ROTATION_STEP = Math.PI / 12;
/** Furthest a piece can be dropped, metres: past this a room photo says nothing reliable. */
const MAX_PLACEMENT_DISTANCE = 10;

function toCanvas(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, gray: toGray(ctx.getImageData(0, 0, width, height).data, width, height) };
}

async function loadPhoto(file: File): Promise<Photo> {
  const exif = readCameraExif(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const { canvas, gray } = toCanvas(bitmap, width, height);
  bitmap.close();
  return { canvas, width, height, gray, focal35: exif.focal35 ?? null, sample: false };
}

function samplePhoto(): Photo {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  drawSampleRoom(canvas.getContext("2d")!);
  return { ...toCanvas(canvas, SAMPLE_WIDTH, SAMPLE_HEIGHT), width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, focal35: null, sample: true };
}

/** Field of view across the longer side for a 35 mm-equivalent focal length: 2·atan(18 / f). */
const fovFrom35mm = (focal35: number) => (2 * Math.atan(18 / focal35) * 180) / Math.PI;

export function RoomPlanner({ product, locale }: { product: PlaceableProduct; locale: string }) {
  const t = useTranslations("room");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const helpId = useId();
  const lensId = useId();
  const sheetId = useId();
  const methodId = useId();
  const heightId = useId();
  const depthSource = useRef<DepthSource | null>(null);

  const [stage, setStage] = useState<Stage>("photo");
  const [method, setMethod] = useState<Method>("paper");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanFailure, setScanFailure] = useState<ScanFailure | null>(null);
  const [heightOverride, setHeightOverride] = useState<number | null>(null);
  const [taps, setTaps] = useState<Point2[]>([]);
  const [loupe, setLoupe] = useState<Point2 | null>(null);
  const [marker, setMarker] = useState<Point2 | null>(null);
  const [fov, setFov] = useState(DEFAULT_FOV_DEGREES);
  const [sheetKind, setSheetKind] = useState<"a4" | "letter">("a4");
  const [flipped, setFlipped] = useState(false);
  const [moved, setMoved] = useState<{ x: number; y: number; rotation: number } | null>(null);
  const [outline, setOutline] = useState(false);
  const [cutout, setCutout] = useState<Cutout | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pixelRatio, setPixelRatio] = useState(1);
  const dragging = useRef<{ kind: "new" } | { kind: "tap"; index: number } | { kind: "product" } | null>(null);

  const number = useCallback((value: number, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value), [locale]);
  const percent = useCallback((value: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value), [locale]);

  // The product photo, with its white studio background removed.
  useEffect(() => {
    if (product.imageSrc === null || product.mode === "lie") return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, width, height);
      const result = cutoutFromWhite(ctx.getImageData(0, 0, width, height).data, width, height);
      if (!result.removed) return;
      ctx.putImageData(new ImageData(result.rgba, width, height), 0, 0);
      setCutout({ image: canvas, box: result.box });
    };
    image.src = product.imageSrc;
    return () => {
      cancelled = true;
    };
  }, [product.imageSrc, product.mode]);

  const K = useMemo(() => (photo === null ? null : intrinsics(focalFromFov(fov, Math.max(photo.width, photo.height)), photo.width, photo.height)), [photo, fov]);

  /**
   * The paper-free mode's floor. The depth map is measured once per photo; the
   * geometry is re-solved whenever the shopper corrects the camera height, which
   * is cheap (RANSAC over a sampled grid) and keeps the drawing live under the
   * slider. The random generator is seeded so the same photo always gives the
   * same answer — a shopper who measures twice should not see two sizes.
   */
  const floor = useMemo((): FloorFromDepth | null => {
    if (measured === null || K === null) return null;
    const assumed = heightOverride ?? 1.4;
    return floorFromDepth(measured.map, K, {
      metric: measured.metric && heightOverride === null,
      cameraHeight: assumed,
      random: seededRandom(1),
    });
  }, [measured, K, heightOverride]);

  const verdict = useMemo(() => (measured === null ? null : judgeFloor(floor)), [measured, floor]);

  const solved = useMemo(() => {
    if (photo === null || K === null || taps.length !== 4) return null;
    const searchRadius = Math.max(6, Math.round((12 * Math.max(photo.width, photo.height)) / MAX_SIDE));
    const snapped = refineCorners(photo.gray, taps, { searchRadius });
    const solution = solveSheet(K, snapped.corners, SHEETS[sheetKind]);
    if (solution === null) return { solution: null } as const;
    const chosen = flipped && solution.alternative !== null ? solution.alternative : solution;
    const height = Math.abs(cameraCentre(chosen.pose)[2]);
    return { solution, chosen, height } as const;
  }, [photo, K, taps, sheetKind, flipped]);

  const camera = useMemo(() => {
    if (K === null) return null;
    if (method === "depth") {
      return floor !== null && verdict?.ok === true ? { K, pose: floor.pose, sheet: null } : null;
    }
    return solved?.chosen !== undefined ? { K, pose: solved.chosen.pose, sheet: solved.chosen.world } : null;
  }, [solved, K, method, floor, verdict]);

  // Until the shopper moves it, the product stands where the measurement put it:
  // on the sheet, which they laid where the piece would go, or — with no sheet —
  // on the floor a couple of metres ahead. Only their moves are state.
  const placement = useMemo((): Placement | null => {
    if (camera === null) return null;
    const spot = camera.sheet === null ? defaultSpot(floor!, { width: product.dims.w / 100, focal: camera.K[0], imageWidth: photo?.width }) : null;
    const x = spot?.x ?? camera.sheet!.reduce((sum, p) => sum + p[0], 0) / 4;
    const y = spot?.y ?? camera.sheet!.reduce((sum, p) => sum + p[1], 0) / 4;
    // Front towards the camera: the box's front face looks along its local −y
    // axis, which after turning by θ is (sin θ, −cos θ); set that to the floor
    // direction from the piece to the camera, as a product photo is taken.
    const centre = cameraCentre(camera.pose);
    const start = { x, y, rotation: Math.atan2(centre[0] - x, -(centre[1] - y)) };
    return {
      ...(moved ?? start),
      width: product.dims.w / 100,
      depth: product.dims.d / 100,
      height: product.mode === "lie" ? 0.005 : product.dims.h / 100,
    };
  }, [camera, moved, product, floor, photo]);

  const distance = camera !== null && placement !== null ? Math.hypot(cameraCentre(camera.pose)[0] - placement.x, cameraCentre(camera.pose)[1] - placement.y) : null;

  // Keep strokes and the loupe the same size on screen whatever the photo's resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || photo === null) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) setPixelRatio(photo.width / rect.width);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [photo, stage]);

  /**
   * Measuring the room, once per photo, on this device. The drawn sample room
   * knows its own depth exactly; a real photograph needs the model, and when
   * that is not installed the page says so and offers the sheet of paper.
   */
  const measure = useCallback(async (current: Photo) => {
    setScanning(true);
    setScanFailure(null);
    setMeasured(null);
    try {
      if (current.sample) {
        const source = sampleDepthSource();
        const map = await source.estimate({ data: new Uint8ClampedArray(0), width: current.width, height: current.height });
        setMeasured({ map, metric: source.metric, ms: source.lastMs ?? 0 });
        return;
      }
      if (depthSource.current === null) {
        const loaded = await loadDepthModel();
        if (!loaded.ok) {
          setScanFailure(loaded.reason);
          return;
        }
        depthSource.current = loaded.source;
      }
      const source = depthSource.current;
      const context = current.canvas.getContext("2d", { willReadFrequently: true })!;
      const { data } = context.getImageData(0, 0, current.width, current.height);
      const map = await source.estimate({ data, width: current.width, height: current.height });
      setMeasured({ map, metric: source.metric, ms: source.lastMs ?? 0 });
    } catch {
      setScanFailure("failed");
    } finally {
      setScanning(false);
    }
  }, []);

  // Someone using a screen reader hears the result rather than seeing the floor
  // light up, so the live region reads the measurement whenever there is one.
  const liveMessage =
    stage === "scan" && floor !== null && verdict?.ok === true ? t("announceFloor", { height: number(floor.cameraHeight) }) : announcement;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || photo === null || stage === "photo") return;
    drawScene(canvas.getContext("2d")!, {
      photo: photo.canvas,
      width: photo.width,
      height: photo.height,
      pixelRatio,
      taps,
      loupe: stage === "corners" ? loupe : null,
      marker: stage === "corners" ? marker : null,
      camera: camera === null ? null : { ...camera, gridCentre: placement === null ? [0, 0] : [placement.x, placement.y] },
      floorPixels: stage === "scan" && floor !== null ? floor.floorPixels : null,
      product: stage === "place" && placement !== null ? { placement, mode: product.mode, cutout, outline } : null,
    });
  });

  const reset = (next: Photo | null, nextMethod: Method = method) => {
    setPhoto(next);
    setMethod(nextMethod);
    setTaps([]);
    setFlipped(false);
    setMoved(null);
    setMarker(null);
    setLoupe(null);
    setMeasured(null);
    setScanFailure(null);
    setHeightOverride(null);
    setStage(next === null ? "photo" : nextMethod === "depth" ? "scan" : "corners");
    if (next !== null) setFov(next.focal35 !== null ? fovFrom35mm(next.focal35) : next.sample ? sampleRoomGeometry().fovDegrees : DEFAULT_FOV_DEGREES);
    // Measuring starts from the action that asked for it, not from a render:
    // the shopper pressed something, and the work begins.
    if (next !== null && nextMethod === "depth") void measure(next);
  };

  /** Switching method keeps the photo: the shopper measures the same room another way. */
  const switchMethod = (nextMethod: Method) => {
    if (photo === null) {
      setMethod(nextMethod);
      return;
    }
    reset(photo, nextMethod);
  };

  const onFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setPhotoError(false);
    try {
      reset(await loadPhoto(file));
    } catch {
      setPhotoError(true);
    }
  };

  const toPhoto = (event: PointerEvent<HTMLCanvasElement>): Point2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * photo!.width, ((event.clientY - rect.top) / rect.height) * photo!.height];
  };

  const moveProductTo = (pixel: Point2) => {
    if (camera === null) return;
    const point = floorPointAt(camera.K, camera.pose, pixel);
    if (point === null) return;
    // Just below the horizon a pixel means "very far away", and a few pixels
    // higher means twice as far: beyond a room's depth the answer is noise, and
    // the piece would be a speck. Drops out there are ignored.
    const centre = cameraCentre(camera.pose);
    if (Math.hypot(point[0] - centre[0], point[1] - centre[1]) > MAX_PLACEMENT_DISTANCE) return;
    setMoved({ x: point[0], y: point[1], rotation: placement?.rotation ?? 0 });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (photo === null) return;
    const point = toPhoto(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (stage === "corners") {
      // While corners are missing, a press is a new corner unless it lands right on
      // an existing one: a sheet across a phone screen can have corners 25 px apart.
      // With all four marked, a press grabs the nearest corner.
      const reach = (taps.length < 4 ? 10 : 40) * pixelRatio;
      const distances = taps.map((tap) => Math.hypot(tap[0] - point[0], tap[1] - point[1]));
      const nearest = distances.length === 0 ? -1 : distances.indexOf(Math.min(...distances));
      const near = nearest >= 0 && distances[nearest]! < reach ? nearest : -1;
      if (near >= 0) dragging.current = { kind: "tap", index: near };
      else if (taps.length < 4) dragging.current = { kind: "new" };
      else return;
      setLoupe(point);
      setMarker(point);
    } else if (stage === "place") {
      dragging.current = { kind: "product" };
      moveProductTo(point);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragging.current;
    if (drag === null || photo === null) return;
    const point = toPhoto(event);
    if (drag.kind === "product") {
      moveProductTo(point);
      return;
    }
    setLoupe(point);
    setMarker(point);
    if (drag.kind === "tap") setTaps((current) => current.map((tap, index) => (index === drag.index ? point : tap)));
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragging.current;
    dragging.current = null;
    if (drag === null || photo === null) return;
    if (drag.kind === "new") addTap(toPhoto(event));
    if (drag.kind === "product" && distance !== null) setAnnouncement(t("announcePlaced", { distance: number(distance) }));
    setLoupe(null);
    setMarker(null);
  };

  const addTap = (point: Point2) => {
    if (taps.length >= 4) return;
    setTaps([...taps, point]);
    setAnnouncement(t("announceCorner", { count: taps.length + 1 }));
    setMoved(null);
    setFlipped(false);
  };

  const rotate = (direction: 1 | -1) => {
    if (placement === null) return;
    const rotation = placement.rotation + direction * ROTATION_STEP;
    setMoved({ x: placement.x, y: placement.y, rotation });
    setAnnouncement(direction === 1 ? t("announceTurnedRight") : t("announceTurnedLeft"));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (photo === null) return;
    const arrows: Record<string, Point2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[event.key];
    const stepCss = event.shiftKey ? 20 : 2;

    if (stage === "corners") {
      const current = marker ?? [photo.width / 2, photo.height / 2];
      if (arrow !== undefined) {
        event.preventDefault();
        const next: Point2 = [
          Math.min(photo.width, Math.max(0, current[0] + arrow[0] * stepCss * pixelRatio)),
          Math.min(photo.height, Math.max(0, current[1] + arrow[1] * stepCss * pixelRatio)),
        ];
        setMarker(next);
        setLoupe(next);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (taps.length < 4) addTap(current);
        setMarker(current);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeLastTap();
      } else if (event.key === "Escape") {
        setLoupe(null);
      }
      return;
    }

    if (stage === "place" && camera !== null && placement !== null) {
      if (arrow !== undefined) {
        event.preventDefault();
        const base = projectPoint(camera.K, camera.pose, [placement.x, placement.y, 0]);
        if (base === null) return;
        const step = (event.shiftKey ? 40 : 10) * pixelRatio;
        moveProductTo([base[0] + arrow[0] * step, base[1] + arrow[1] * step]);
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        rotate(event.shiftKey ? -1 : 1);
      }
    }
  };

  const removeLastTap = () => {
    setTaps((current) => current.slice(0, -1));
    setMoved(null);
    setFlipped(false);
  };

  const save = () => {
    canvasRef.current?.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vitrine-room.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  };

  const steps: { id: Stage; label: string }[] = [
    { id: "photo", label: t("steps.photo") },
    method === "depth" ? { id: "scan", label: t("steps2Scan") } : { id: "corners", label: t("steps.corners") },
    { id: "place", label: t("steps.place") },
  ];
  const stageIndex = steps.findIndex((step) => step.id === stage);
  const solution = solved?.solution ?? null;
  const cameraHeight = solved?.height ?? null;
  const fitsBadly = solved?.chosen !== undefined && solved.chosen.rms > 3;
  const unusualHeight = cameraHeight !== null && (cameraHeight < 0.4 || cameraHeight > 2.6);

  return (
    <div className="flex flex-col gap-6">
      <ol aria-label={t("stepsLabel")} className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={index === stageIndex ? "step" : undefined} className={cn("flex items-center gap-2", index === stageIndex ? "text-dusk font-medium" : "text-slate")}>
            <span
              className={cn(
                "tabular inline-flex size-6 items-center justify-center rounded-full border text-xs",
                index === stageIndex ? "bg-dusk text-glass border-dusk" : index < stageIndex ? "border-dusk/35" : "border-hairline",
              )}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      {stage === "photo" ? (
        <section className="bg-dusk text-glass rounded-plinth flex flex-col gap-5 px-6 py-10 md:px-10 md:py-14" data-agent-id="room:photo">
          <h2 className="font-display text-2xl">{t("photoTitle")}</h2>
          <p className="text-mist max-w-[60ch]">{method === "depth" ? t("photoHelpFree") : t("photoHelp")}</p>

          <fieldset className="flex flex-col gap-3" data-agent-id="room:method">
            <legend className="mb-2 font-medium">{t("methodLabel")}</legend>
            {(["paper", "depth"] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  "rounded-plinth flex cursor-pointer gap-3 border p-4 transition-colors",
                  method === option ? "border-glass bg-glass/10" : "border-mist/40 hover:border-mist",
                )}
              >
                <input
                  type="radio"
                  name={methodId}
                  value={option}
                  checked={method === option}
                  onChange={() => setMethod(option)}
                  className="accent-lumen mt-1 size-5 shrink-0"
                  data-agent-id={`room:method-${option}`}
                />
                <span className="flex flex-col gap-1">
                  <span className="font-medium">{option === "paper" ? t("methodPaper") : t("methodFree")}</span>
                  <span className="text-mist text-sm">{option === "paper" ? t("methodPaperHelp") : t("methodFreeHelp")}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <input
              id={`${helpId}-file`}
              type="file"
              accept="image/*"
              className="peer sr-only"
              onChange={(event) => void onFile(event.currentTarget.files?.[0])}
            />
            <label
              htmlFor={`${helpId}-file`}
              className="bg-glass text-dusk hover:bg-glass/90 rounded-plinth peer-focus-visible:outline-glass inline-flex h-11 cursor-pointer items-center px-5 font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
            >
              {t("choosePhoto")}
            </label>
            <button
              type="button"
              onClick={() => reset(samplePhoto())}
              className="border-mist/50 text-glass hover:border-glass rounded-plinth h-11 border px-5 font-medium transition-colors"
            >
              {t("trySample")}
            </button>
          </div>
          {photoError ? (
            <p role="alert" className="text-glass text-sm">
              {t("photoError")}
            </p>
          ) : null}
          <p className="text-mist text-sm">{t("privacy")}</p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="bg-dusk rounded-plinth flex justify-center p-2 md:p-3">
            <canvas
              ref={canvasRef}
              width={photo?.width}
              height={photo?.height}
              tabIndex={0}
              role="application"
              aria-label={t("stageLabel")}
              aria-describedby={helpId}
              data-agent-id="room:stage"
              className={cn("block h-auto max-h-[75vh] w-auto max-w-full touch-none select-none", stage === "place" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair")}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragging.current = null;
                setLoupe(null);
              }}
              onKeyDown={onKeyDown}
              onFocus={() => {
                if (stage === "corners" && marker === null && photo !== null) setMarker([photo.width / 2, photo.height / 2]);
              }}
              onBlur={() => {
                setLoupe(null);
                setMarker(null);
              }}
            />
          </div>

          <aside className="flex flex-col gap-5" aria-labelledby={`${helpId}-title`}>
            {stage === "scan" ? (
              <>
                <h2 id={`${helpId}-title`} className="font-display text-2xl">
                  {t("scanTitle")}
                </h2>
                <div id={helpId} className="text-slate flex flex-col gap-2 text-sm">
                  <p>{t("scanHelp")}</p>
                  {photo?.sample ? <p>{t("scanSample")}</p> : null}
                </div>

                {scanning ? (
                  <p className="text-dusk text-sm font-medium" data-agent-id="room:scanning">
                    {t("scanWorking")}
                  </p>
                ) : null}

                {scanFailure !== null ? (
                  <p role="alert" className="text-danger text-sm" data-agent-id="room:scan-error">
                    {scanFailure === "not_installed"
                      ? t("scanNotInstalled")
                      : scanFailure === "no_webassembly" || scanFailure === "unsupported_output"
                        ? t("scanUnsupported")
                        : t("scanFailed")}
                  </p>
                ) : null}

                {verdict !== null && !verdict.ok ? (
                  <p role="alert" className="text-danger text-sm" data-agent-id="room:scan-error">
                    {verdict.reason === "little_floor"
                      ? t("scanLittleFloor")
                      : verdict.reason === "rough_floor"
                        ? t("scanRoughFloor")
                        : verdict.reason === "steep"
                          ? t("scanSteep")
                          : t("scanNoFloor")}
                  </p>
                ) : null}

                {floor !== null && verdict?.ok === true ? (
                  <div className="flex flex-col gap-2 text-sm" data-agent-id="room:scan">
                    <p className="text-success font-medium">{t("scanReady")}</p>
                    <p className="text-slate tabular">{t("cameraHeight", { height: number(floor.cameraHeight) })}</p>
                    <p className="text-slate tabular">{t("scanFloorShare", { share: percent(floor.coverage) })}</p>
                    {measured !== null && measured.ms > 0 ? <p className="text-slate tabular">{t("scanTook", { seconds: number(measured.ms / 1000) })}</p> : null}
                  </div>
                ) : null}

                {floor !== null ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={heightId} className="flex items-baseline justify-between text-sm font-medium">
                      {t("heightLabel")}
                      <span className="tabular text-slate font-normal">{t("heightValue", { height: number(floor.cameraHeight, 2) })}</span>
                    </label>
                    <input
                      id={heightId}
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={Number(floor.cameraHeight.toFixed(2))}
                      onChange={(event) => {
                        setHeightOverride(Number(event.currentTarget.value));
                        setMoved(null);
                      }}
                      className="accent-dusk h-11 w-full cursor-pointer"
                      aria-describedby={`${heightId}-hint`}
                      data-agent-id="room:camera-height"
                    />
                    <p id={`${heightId}-hint`} className="text-slate text-xs">
                      {measured?.metric === true && heightOverride === null ? t("heightHelpMetric") : t("heightHelpAssumed")}
                    </p>
                  </div>
                ) : null}

                <p className="text-slate text-xs">{t("accuracyNote")}</p>

                <div className="flex flex-wrap gap-3">
                  {verdict?.ok === true ? (
                    <Button onClick={() => setStage("place")} data-agent-id="action:room-place">
                      {t("placeProduct")}
                    </Button>
                  ) : null}
                  {measured !== null || scanFailure !== null ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setHeightOverride(null);
                        if (photo !== null) void measure(photo);
                      }}
                    >
                      {t("scanAgain")}
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => switchMethod("paper")} data-agent-id="action:room-use-paper">
                    {t("scanUsePaper")}
                  </Button>
                  <Button variant="tertiary" onClick={() => reset(null)}>
                    {t("newPhoto")}
                  </Button>
                </div>
              </>
            ) : stage === "corners" ? (
              <>
                <h2 id={`${helpId}-title`} className="font-display text-2xl">
                  {t("cornersTitle")}
                </h2>
                <div id={helpId} className="text-slate flex flex-col gap-2 text-sm">
                  <p>{t("cornersHelp")}</p>
                  <p>{t("keyboardCorners")}</p>
                  {photo?.sample ? <p>{t("sampleNote")}</p> : null}
                </div>
                <p className="tabular text-sm font-medium" data-agent-id="room:corner-count">
                  {t("cornersProgress", { count: taps.length })}
                </p>

                {taps.length === 4 && solution === null ? (
                  <p role="alert" className="text-danger text-sm">
                    {t("notSheet")}
                  </p>
                ) : null}

                {camera !== null && cameraHeight !== null ? (
                  <div className="flex flex-col gap-2 text-sm" data-agent-id="room:floor">
                    <p className="text-success font-medium">{t("floorFound")}</p>
                    <p className="text-slate tabular">{t("cameraHeight", { height: number(cameraHeight) })}</p>
                    {fitsBadly ? <p className="text-dusk">{t("checkCorners")}</p> : null}
                    {unusualHeight ? <p className="text-dusk">{t("unusualHeight", { height: number(cameraHeight) })}</p> : null}
                    {solution?.ambiguous ? <p className="text-dusk">{t("ambiguous")}</p> : null}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2">
                  <label htmlFor={lensId} className="flex items-baseline justify-between text-sm font-medium">
                    {t("lens")}
                    <span className="tabular text-slate font-normal">{t("lensValue", { degrees: Math.round(fov) })}</span>
                  </label>
                  <input
                    id={lensId}
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={Math.round(fov)}
                    onChange={(event) => setFov(Number(event.currentTarget.value))}
                    className="accent-dusk h-11 w-full cursor-pointer"
                    aria-describedby={`${lensId}-hint`}
                  />
                  <p id={`${lensId}-hint`} className="text-slate text-xs">
                    {photo?.focal35 != null ? t("lensFromPhoto", { mm: photo.focal35 }) : photo?.sample ? t("lensSample") : t("lensEstimated")}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor={sheetId} className="text-sm font-medium">
                    {t("sheetSize")}
                  </label>
                  <select
                    id={sheetId}
                    value={sheetKind}
                    onChange={(event) => setSheetKind(event.currentTarget.value === "letter" ? "letter" : "a4")}
                    className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full cursor-pointer border bg-white px-3 transition-colors"
                  >
                    <option value="a4">{t("sheetA4")}</option>
                    <option value="letter">{t("sheetLetter")}</option>
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  {camera !== null ? (
                    <>
                      <Button onClick={() => setStage("place")} data-agent-id="action:room-place">
                        {t("placeProduct")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          // The sheet's axes swap, so a placement in the old floor coordinates would jump.
                          setFlipped((value) => !value);
                          setMoved(null);
                        }}
                      >
                        {t("turnSheet")}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="secondary" onClick={removeLastTap} aria-disabled={taps.length === 0 || undefined}>
                    {t("undoCorner")}
                  </Button>
                  <Button variant="tertiary" onClick={() => switchMethod("depth")} data-agent-id="action:room-no-paper">
                    {t("methodFree")}
                  </Button>
                  <Button variant="tertiary" onClick={() => reset(null)}>
                    {t("newPhoto")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 id={`${helpId}-title`} className="font-display text-2xl">
                  {t("placeTitle")}
                </h2>
                <div id={helpId} className="text-slate flex flex-col gap-2 text-sm">
                  <p>{t("placeHelp")}</p>
                  <p>{t("keyboardPlace")}</p>
                  {product.mode === "lie" ? <p>{t("footprintNote")}</p> : null}
                  {product.mode === "stand" && product.imageSrc !== null && cutout === null ? <p>{t("noCutout")}</p> : null}
                </div>
                <dl className="border-hairline divide-hairline divide-y border-y text-sm" data-agent-id="room:readout">
                  <div className="flex justify-between gap-4 py-3">
                    <dt className="text-slate">{t("trueSizeLabel")}</dt>
                    <dd className="tabular">{t("trueSize", product.dims)}</dd>
                  </div>
                  {distance !== null ? (
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-slate">{t("distanceLabel")}</dt>
                      <dd className="tabular">{t("distance", { distance: number(distance) })}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => rotate(-1)}>
                    {t("rotateLeft")}
                  </Button>
                  <Button variant="secondary" onClick={() => rotate(1)}>
                    {t("rotateRight")}
                  </Button>
                </div>
                {product.mode === "stand" ? (
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={outline} onChange={(event) => setOutline(event.currentTarget.checked)} className="accent-dusk size-5" />
                    {t("outline")}
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button onClick={save}>{t("save")}</Button>
                  <Button variant="secondary" onClick={() => setStage(method === "depth" ? "scan" : "corners")}>
                    {method === "depth" ? t("backToScan") : t("backToCorners")}
                  </Button>
                  <Button variant="tertiary" onClick={() => reset(null)}>
                    {t("newPhoto")}
                  </Button>
                </div>
              </>
            )}
            <p className="text-slate text-xs">{t("privacy")}</p>
          </aside>
        </div>
      )}
    </div>
  );
}
