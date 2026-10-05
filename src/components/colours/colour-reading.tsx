"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Your colours: a reading of skin, eyes and hair from the camera or a photograph, on the device, and the colours that suit them in the shop.
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { frameSize, loadFaceTracker, type FaceTracker, type FrameSource } from "@/components/mirror/face-tracker";
import { Button, ButtonLink } from "@/components/ui/button";
import { readColours, labToSrgb, type ColourReading, type Lab } from "@/lib/vision/colour-season";
import { colorLabel } from "@/lib/search/vocabulary";
import { colourSwatch } from "@/lib/vision/palette";

/**
 * docs/adr/066. The picture — a frame from the front camera, or a
 * photograph chosen from the device — is read in this tab by the same face
 * landmarker as the AR Mirror (docs/adr/065) and the colour reading
 * (colour-season.ts); nothing is sent or kept. Keeping the colours in Your
 * shop is a separate, explicit step, and keeps only colour words.
 */

type Phase = "intro" | "camera" | "reading" | "result" | "error";
type Problem = "camera_denied" | "no_camera" | "no_face" | "not_installed" | "failed" | "unreadable";

const rgb = (lab: Lab) => {
  const [r, g, b] = labToSrgb(lab);
  return `rgb(${r} ${g} ${b})`;
};

export function ColourReadingPanel() {
  const t = useTranslations("colours");
  const locale = useLocale();
  const words = (colour: string) => colorLabel(colour, locale === "el" ? "el" : "en");
  const [phase, setPhase] = useState<Phase>("intro");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reading, setReading] = useState<ColourReading | null>(null);
  const [kept, setKept] = useState<"idle" | "saving" | "kept" | "failed">("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  useEffect(
    () => () => {
      stopCamera();
      trackerRef.current?.close();
    },
    [stopCamera],
  );

  const tracker = useCallback(async (): Promise<FaceTracker | null> => {
    if (trackerRef.current !== null) return trackerRef.current;
    const loaded = await loadFaceTracker();
    if (!loaded.ok) {
      setProblem(loaded.reason === "not_installed" ? "not_installed" : "failed");
      setPhase("error");
      return null;
    }
    trackerRef.current = loaded.tracker;
    return loaded.tracker;
  }, []);

  /** Reads a still picture on a canvas: landmarks first, then colours from the same pixels. */
  const readCanvas = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setPhase("reading");
      const found = await tracker();
      if (found === null) return;
      const frame = found.detect(canvas as FrameSource, performance.now());
      if (frame === null) {
        setProblem("no_face");
        setPhase("error");
        return;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
      const result = pixels === undefined ? null : readColours({ rgba: pixels.data, width: canvas.width, height: canvas.height }, frame.landmarks);
      if (result === null) {
        setProblem("unreadable");
        setPhase("error");
        return;
      }
      setReading(result);
      setKept("idle");
      setPhase("result");
    },
    [tracker],
  );

  const openCamera = async () => {
    setProblem(null);
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setProblem("no_camera");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      setPhase("camera");
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      // Start loading the model while the shopper gets ready.
      void tracker();
    } catch (error) {
      stopCamera();
      setProblem(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "camera_denied" : "no_camera");
      setPhase("error");
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (video === null) return;
    const { width, height } = frameSize(video);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    stopCamera();
    await readCanvas(canvas);
  };

  const choosePhoto = async (file: File | undefined) => {
    if (file === undefined) return;
    setProblem(null);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      await readCanvas(canvas);
    } catch {
      setProblem("unreadable");
      setPhase("error");
    }
  };

  const keep = async () => {
    if (reading === null) return;
    setKept("saving");
    const response = await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ like: { colors: reading.palette }, avoid: { colors: reading.avoid } }),
    }).catch(() => null);
    setKept(response?.ok === true ? "kept" : "failed");
  };

  const shopHref = reading === null ? "/c/wear" : `/c/wear?${reading.palette.map((colour) => `color=${colour}`).join("&")}`;

  return (
    <div className="mt-8 flex flex-col gap-8" data-agent-id="colours:panel" data-colours-phase={phase}>
      {phase === "intro" || phase === "error" ? (
        <div className="border-hairline rounded-plinth flex max-w-[70ch] flex-col gap-4 border p-5" data-agent-id="colours:intro">
          <ul className="text-slate flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>{t("promises.device")}</li>
            <li>{t("promises.light")}</li>
            <li>{t("promises.convention")}</li>
          </ul>
          {problem === null ? null : (
            <p role="alert" className="text-danger text-sm" data-agent-id="colours:problem">
              {t(`problems.${problem}`)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void openCamera()} data-agent-id="colours:camera">
              {t("useCamera")}
            </Button>
            <label className="border-hairline rounded-plinth hover:border-dusk/40 inline-flex h-11 cursor-pointer items-center border bg-white px-4 text-sm font-medium has-[:focus-visible]:outline-2">
              {t("usePhoto")}
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => void choosePhoto(event.target.files?.[0])} data-agent-id="colours:photo" />
            </label>
          </div>
        </div>
      ) : null}

      <div className={phase === "camera" ? "flex flex-col gap-4" : "hidden"}>
        <div className="bg-dusk rounded-plinth relative mx-auto aspect-[4/3] w-full max-w-[640px] overflow-hidden">
          <video ref={videoRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" playsInline muted aria-hidden="true" />
        </div>
        <p className="text-slate text-sm">{t("cameraHint")}</p>
        <div className="flex gap-3">
          <Button onClick={() => void capture()} data-agent-id="colours:read">
            {t("read")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              stopCamera();
              setPhase("intro");
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </div>

      {phase === "reading" ? (
        <p role="status" className="text-slate text-sm" data-agent-id="colours:reading">
          {t("reading")}
        </p>
      ) : null}

      {phase === "result" && reading !== null ? (
        <section aria-labelledby="colours-result" className="flex flex-col gap-6" data-agent-id="colours:result" data-season={reading.season}>
          <div className="flex flex-col gap-2">
            <h2 id="colours-result" className="font-display text-2xl">
              {t(`seasons.${reading.season}.name`)}
            </h2>
            <p className="max-w-[65ch]">{t(`seasons.${reading.season}.about`)}</p>
            <p className="text-slate text-sm">{t("measured", { warmth: t(reading.warm ? "warm" : "cool"), depth: t(reading.light ? "light" : "deep") })}</p>
          </div>
          <ul className="flex flex-wrap gap-4" aria-label={t("yourColours")}>
            {(
              [
                ["skin", reading.skin],
                ["eyes", reading.eyes],
                ["hair", reading.hair],
              ] as const
            ).map(([part, lab]) =>
              lab === null ? null : (
                <li key={part} className="flex items-center gap-2 text-sm">
                  <span className="border-hairline size-8 rounded-full border" style={{ background: rgb(lab) }} aria-hidden="true" />
                  {t(`parts.${part}`)}
                </li>
              ),
            )}
          </ul>
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-xl">{t("suits")}</h3>
            <ul className="flex flex-wrap gap-2" data-agent-id="colours:palette">
              {reading.palette.map((colour) => {
                const swatch = colourSwatch(colour as Parameters<typeof colourSwatch>[0]);
                return (
                  <li key={colour}>
                    <ButtonLink href={`/c/wear?color=${colour}`} variant="secondary" className="gap-2" data-agent-id={`colours:shop:${colour}`}>
                      <span className="border-hairline size-4 rounded-full border" style={{ background: `rgb(${swatch.r} ${swatch.g} ${swatch.b})` }} aria-hidden="true" />
                      {words(colour)}
                    </ButtonLink>
                  </li>
                );
              })}
            </ul>
            <p className="text-slate text-sm">{t("easyOn", { colours: reading.avoid.map((colour) => words(colour)).join(", ") })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={shopHref} data-agent-id="colours:shop-all">
              {t("shopAll")}
            </ButtonLink>
            <Button variant="secondary" onClick={() => void keep()} disabled={kept === "saving" || kept === "kept"} data-agent-id="colours:keep">
              {t("keep")}
            </Button>
            <Button
              variant="tertiary"
              onClick={() => {
                setReading(null);
                setPhase("intro");
              }}
            >
              {t("again")}
            </Button>
          </div>
          <p className="text-slate text-xs" role="status" data-agent-id="colours:kept">
            {kept === "kept" ? t("kept") : kept === "failed" ? t("keepFailed") : t("private")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
