"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Measurement bench for evaluation E4: marks real room photos and reports each method's size error.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { loadDepthModel, type DepthSource } from "@/components/room/depth-estimator";
import { Button } from "@/components/ui/button";
import { cameraCentre, focalFromFov, intrinsics, projectPoint, solveSheet, type Point2 } from "@/lib/vision/camera";
import { refineCorners, toGray, type GrayImage } from "@/lib/vision/corners";
import { floorFromDepth, judgeFloor } from "@/lib/vision/depth";
import { compareMethods, measureWithPose, summariseE4, type E4Marks, type E4Record } from "@/lib/vision/e4";
import { readCameraExif } from "@/lib/vision/exif";
import { cn } from "@/lib/ui/cn";

/**
 * The bench for the real-photo half of evaluation E4 (docs/PLAN.md Phase 10).
 * It is not part of the shop: it is the instrument George uses to produce the
 * report's numbers, so it is deliberately plain, English-only and never
 * deployed (the page around it exists only on the local build).
 *
 * WHAT IT ASKS FOR, per photo: the four corners of the A4 sheet, the foot and
 * the top of an object whose height was measured with a tape, and that height.
 * From those it recovers the camera both ways — from the sheet, and from a depth
 * map with no sheet at all — and reports how wrong each one would draw that
 * object (src/lib/vision/e4.ts).
 *
 * WHAT LEAVES THE MACHINE: nothing. Photos are read in the browser and never
 * uploaded; the saved measurements are numbers and file names, kept in this
 * browser until exported to a file by hand.
 */

const STORE_KEY = "vitrine.e4.records";
const MAX_SIDE = 2048;

type Loaded = { file: string; canvas: HTMLCanvasElement; width: number; height: number; gray: GrayImage; focal35: number | null };
type Mode = "sheet" | "base" | "top";

type Computed = {
  paper: E4Record["paper"];
  depth: E4Record["depth"];
  depthNote: string | null;
  /** Where the sheet method thinks the object's top is, for drawing against the mark. */
  paperTop: Point2 | null;
  depthTop: Point2 | null;
};

async function loadPhoto(file: File): Promise<Loaded> {
  const exif = readCameraExif(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const gray = toGray(context.getImageData(0, 0, width, height).data, width, height);
  return { file: file.name, canvas, width, height, gray, focal35: exif.focal35 ?? null };
}

const fovFrom35mm = (focal35: number) => (2 * Math.atan(18 / focal35) * 180) / Math.PI;

export function E4Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const depthSource = useRef<DepthSource | null>(null);

  const [photos, setPhotos] = useState<Loaded[]>([]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("sheet");
  const [sheet, setSheet] = useState<Point2[]>([]);
  const [base, setBase] = useState<Point2 | null>(null);
  const [top, setTop] = useState<Point2 | null>(null);
  const [heightCm, setHeightCm] = useState("40");
  const [note, setNote] = useState("");
  const [records, setRecords] = useState<E4Record[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      return saved === null ? [] : (JSON.parse(saved) as E4Record[]);
    } catch {
      // A browser with storage switched off still measures; only the list is lost.
      return [];
    }
  });
  const [computed, setComputed] = useState<Computed | null>(null);
  const [working, setWorking] = useState(false);

  const photo = photos[index] ?? null;

  const remember = (next: E4Record[]) => {
    setRecords(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Same as above: measuring still works.
    }
  };

  const K = useMemo(() => {
    if (photo === null) return null;
    const fov = photo.focal35 === null ? 69 : fovFrom35mm(photo.focal35);
    return intrinsics(focalFromFov(fov, Math.max(photo.width, photo.height)), photo.width, photo.height);
  }, [photo]);

  const marks: E4Marks | null = useMemo(
    () => (sheet.length === 4 && base !== null && top !== null && Number(heightCm) > 0 ? { sheet, base, top, objectHeightCm: Number(heightCm) } : null),
    [sheet, base, top, heightCm],
  );

  /** Recovers the camera both ways and measures the object with each. */
  const measure = useCallback(async () => {
    if (photo === null || K === null || marks === null) return;
    setWorking(true);
    try {
      const snapped = refineCorners(photo.gray, marks.sheet, { searchRadius: 12 });
      const solution = solveSheet(K, snapped.corners);
      const paper =
        solution === null
          ? null
          : measureWithPose(K, solution.pose, { ...marks, sheet: snapped.corners }, Math.abs(cameraCentre(solution.pose)[2]));
      const paperTop =
        solution === null || paper === null ? null : projectPoint(K, solution.pose, [0, 0, 0]) === null ? null : predictedTop(K, solution.pose, marks);

      let depth: Computed["depth"] = null;
      let depthTop: Point2 | null = null;
      let depthNote: string | null = null;
      const loaded = depthSource.current === null ? await loadDepthModel() : ({ ok: true, source: depthSource.current } as const);
      if (!loaded.ok) {
        depthNote =
          loaded.reason === "not_installed"
            ? "No depth model installed (public/models/depth). The sheet column is still measured."
            : `The depth model could not run: ${loaded.reason}.`;
      } else {
        depthSource.current = loaded.source;
        const context = photo.canvas.getContext("2d", { willReadFrequently: true })!;
        const { data } = context.getImageData(0, 0, photo.width, photo.height);
        const map = await loaded.source.estimate({ data, width: photo.width, height: photo.height });
        const floor = floorFromDepth(map, K, { metric: loaded.source.metric, cameraHeight: 1.4 });
        const verdict = judgeFloor(floor);
        if (floor === null || !verdict.ok) {
          depthNote = `The paper-free method refused this photo: ${verdict.reason ?? "no floor"}.`;
        } else {
          const result = measureWithPose(K, floor.pose, marks, floor.cameraHeight);
          depth =
            result === null
              ? null
              : { ...result, floorShare: floor.floorShare, planeRmsRelative: floor.planeRmsRelative, metric: loaded.source.metric };
          depthTop = predictedTop(K, floor.pose, marks);
          if (result === null) depthNote = "The paper-free camera cannot explain the marks (the foot lands above its horizon).";
        }
      }
      setComputed({ paper, depth, depthNote, paperTop, depthTop });
    } finally {
      setWorking(false);
    }
  }, [photo, K, marks]);

  const save = () => {
    if (photo === null || computed === null) return;
    const record: E4Record = {
      file: photo.file,
      width: photo.width,
      height: photo.height,
      focalFrom: photo.focal35 === null ? "assumed" : "exif",
      objectHeightCm: Number(heightCm),
      paper: computed.paper,
      depth: computed.depth,
      note: note.trim() === "" ? undefined : note.trim(),
      measuredAt: new Date().toISOString(),
    };
    remember([...records.filter((existing) => existing.file !== record.file), record]);
    if (index < photos.length - 1) select(index + 1);
  };

  const select = (next: number) => {
    setIndex(next);
    setMode("sheet");
    setSheet([]);
    setBase(null);
    setTop(null);
    setNote("");
    setComputed(null);
  };

  const onFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const loaded: Loaded[] = [];
    for (const file of Array.from(files)) {
      try {
        loaded.push(await loadPhoto(file));
      } catch {
        // Skip anything that is not a photo; the list shows what loaded.
      }
    }
    setPhotos(loaded);
    select(0);
  };

  const exportJson = () => {
    const blob = new Blob([`${JSON.stringify(records, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "e4-real.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // Draw the photo with the marks, and — once measured — each method's answer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || photo === null) return;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, photo.width, photo.height);
    context.drawImage(photo.canvas, 0, 0);
    const scale = Math.max(1, photo.width / 1000);

    context.lineWidth = 2 * scale;
    context.strokeStyle = "rgba(245, 181, 68, 0.95)";
    if (sheet.length > 1) {
      context.beginPath();
      sheet.forEach((point, i) => (i === 0 ? context.moveTo(point[0], point[1]) : context.lineTo(point[0], point[1])));
      if (sheet.length === 4) context.closePath();
      context.stroke();
    }
    sheet.forEach((point, i) => {
      context.beginPath();
      context.arc(point[0], point[1], 6 * scale, 0, 2 * Math.PI);
      context.fillStyle = "rgba(245, 181, 68, 0.95)";
      context.fill();
      context.fillStyle = "#1d2330";
      context.font = `${10 * scale}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(i + 1), point[0], point[1]);
    });

    if (base !== null && top !== null) {
      line(context, base, top, "rgba(255, 255, 255, 0.95)", 3 * scale);
    }
    for (const [point, colour] of [
      [base, "rgba(255, 255, 255, 0.95)"],
      [top, "rgba(255, 255, 255, 0.95)"],
    ] as const) {
      if (point === null) continue;
      context.beginPath();
      context.arc(point[0], point[1], 5 * scale, 0, 2 * Math.PI);
      context.strokeStyle = colour;
      context.lineWidth = 2 * scale;
      context.stroke();
    }
    // Each method's predicted top, against the marked one: the error, drawn.
    if (base !== null && computed?.paperTop != null) line(context, base, computed.paperTop, "rgba(92, 191, 143, 0.95)", 2 * scale);
    if (base !== null && computed?.depthTop != null) line(context, base, computed.depthTop, "rgba(120, 170, 255, 0.95)", 2 * scale);
  });

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (photo === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point: Point2 = [((event.clientX - rect.left) / rect.width) * photo.width, ((event.clientY - rect.top) / rect.height) * photo.height];
    if (mode === "sheet") {
      const next = sheet.length >= 4 ? [point] : [...sheet, point];
      setSheet(next);
      if (next.length === 4) setMode("base");
    } else if (mode === "base") {
      setBase(point);
      setMode("top");
    } else {
      setTop(point);
    }
    setComputed(null);
  };

  const summary = useMemo(() => compareMethods(records), [records]);
  const paper = summariseE4(records, "paper");
  const depth = summariseE4(records, "depth");
  const percent = (value: number, digits = 1) => (Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">1. Open the room photos</h2>
        <p className="text-slate max-w-[70ch] text-sm">
          Each photo needs an A4 sheet flat on the floor and an object of known height standing on the floor. Photos stay on this
          machine: nothing is uploaded, and only the numbers below are saved.
        </p>
        <input type="file" accept="image/*" multiple onChange={(event) => void onFiles(event.currentTarget.files)} className="max-w-md text-sm" />
        {photos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((item, i) => (
              <button
                key={item.file}
                type="button"
                onClick={() => select(i)}
                className={cn(
                  "rounded-plinth border px-3 py-1 text-xs",
                  i === index ? "border-dusk bg-dusk text-glass" : "border-hairline hover:border-dusk/40",
                  records.some((record) => record.file === item.file) ? "font-medium" : "",
                )}
              >
                {records.some((record) => record.file === item.file) ? "✓ " : ""}
                {item.file}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {photo === null ? null : (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="bg-dusk rounded-plinth p-2">
            <canvas
              ref={canvasRef}
              width={photo.width}
              height={photo.height}
              onPointerDown={onPointerDown}
              className="block h-auto max-h-[70vh] w-auto max-w-full cursor-crosshair touch-none select-none"
              data-agent-id="e4:stage"
            />
          </div>

          <div className="flex flex-col gap-5">
            <h2 className="font-display text-xl">2. Mark the photo</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              {(["sheet", "base", "top"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={cn("rounded-plinth border px-3 py-2", mode === option ? "border-dusk bg-dusk text-glass" : "border-hairline")}
                >
                  {option === "sheet" ? `Sheet corners (${sheet.length}/4)` : option === "base" ? `Object foot ${base === null ? "" : "✓"}` : `Object top ${top === null ? "" : "✓"}`}
                </button>
              ))}
            </div>
            <p className="text-slate text-sm">
              Mark the sheet clockwise or anticlockwise, then the point where the object meets the floor, then its top — directly above
              the foot.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              Measured height of the object (cm)
              <input
                type="number"
                min={5}
                max={250}
                value={heightCm}
                onChange={(event) => setHeightCm(event.currentTarget.value)}
                className="border-hairline rounded-plinth h-11 border px-3"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Note (floor, light, anything odd)
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                className="border-hairline rounded-plinth h-11 border px-3"
              />
            </label>
            <p className="text-slate text-xs">
              Lens: {photo.focal35 === null ? "not in the photo's data, assuming 69°" : `${photo.focal35} mm equivalent, from the photo`}
            </p>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void measure()} aria-disabled={marks === null || working || undefined} data-agent-id="e4:measure">
                {working ? "Measuring…" : "Measure this photo"}
              </Button>
              <Button variant="secondary" onClick={save} aria-disabled={computed === null || undefined}>
                Save and next
              </Button>
            </div>

            {computed === null ? null : (
              <dl className="border-hairline divide-hairline divide-y border-y text-sm" data-agent-id="e4:result">
                <Row label="Sheet method">
                  {computed.paper === null ? "no answer" : `${percent(computed.paper.sizeError)} off, camera ${computed.paper.cameraHeight.toFixed(2)} m`}
                </Row>
                <Row label="Without paper">
                  {computed.depth === null ? "no answer" : `${percent(computed.depth.sizeError)} off, camera ${computed.depth.cameraHeight.toFixed(2)} m`}
                </Row>
                {computed.depthNote === null ? null : <Row label="Note">{computed.depthNote}</Row>}
              </dl>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">3. Results so far ({records.length} rooms)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-hairline border-b text-left">
                <th className="py-2 pr-4 font-medium">Photo</th>
                <th className="py-2 pr-4 font-medium">Object</th>
                <th className="py-2 pr-4 font-medium">Sheet</th>
                <th className="py-2 pr-4 font-medium">Without paper</th>
                <th className="py-2 pr-4 font-medium">Note</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="tabular">
              {records.map((record) => (
                <tr key={record.file} className="border-hairline border-b">
                  <td className="py-2 pr-4">{record.file}</td>
                  <td className="py-2 pr-4">{record.objectHeightCm} cm</td>
                  <td className="py-2 pr-4">{record.paper === null ? "—" : percent(record.paper.sizeError)}</td>
                  <td className="py-2 pr-4">{record.depth === null ? "—" : percent(record.depth.sizeError)}</td>
                  <td className="text-slate py-2 pr-4">{record.note ?? ""}</td>
                  <td className="py-2">
                    <button type="button" className="text-danger underline" onClick={() => remember(records.filter((other) => other.file !== record.file))}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-slate py-3">
                    Nothing measured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <dl className="border-hairline divide-hairline divide-y border-y text-sm" data-agent-id="e4:summary">
          <Row label="Sheet method">
            {paper.count} rooms, mean error {percent(paper.mape)}, p90 {percent(paper.p90)}, within 10%: {percent(paper.within10, 0)}
          </Row>
          <Row label="Without paper">
            {depth.count} rooms, mean error {percent(depth.mape)}, p90 {percent(depth.p90)}, within 10%: {percent(depth.within10, 0)}
          </Row>
          <Row label="Same rooms, both methods">
            {summary.both.count} rooms: sheet {percent(summary.both.paperMape)}, without paper {percent(summary.both.depthMape)}
          </Row>
        </dl>

        <div className="flex flex-wrap gap-3">
          <Button onClick={exportJson} aria-disabled={records.length === 0 || undefined} data-agent-id="e4:export">
            Export e4-real.json
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              if (window.confirm("Remove every saved measurement?")) remember([]);
            }}
          >
            Clear
          </Button>
        </div>
        <p className="text-slate text-xs">
          Save the exported file as <code>.local/e4/e4-real.json</code> and run <code>pnpm evals:room-real</code> to write the report table.
        </p>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-4 py-2">
      <dt className="text-slate">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function line(context: CanvasRenderingContext2D, from: Point2, to: Point2, colour: string, width: number) {
  context.beginPath();
  context.moveTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.stroke();
}

/** Where a method says the object's top should be, given where its foot was marked. */
function predictedTop(K: Parameters<typeof projectPoint>[0], pose: Parameters<typeof projectPoint>[1], marks: E4Marks): Point2 | null {
  const result = measureWithPose(K, pose, marks, 0);
  if (result === null) return null;
  // Along the marked direction, at the predicted length: what the shopper would see drawn.
  const dx = marks.top[0] - marks.base[0];
  const dy = marks.top[1] - marks.base[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return [marks.base[0] + (dx / length) * result.predictedPx, marks.base[1] + (dy / length) * result.predictedPx];
}
