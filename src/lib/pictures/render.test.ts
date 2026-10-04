/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for making an AI picture: what the model is sent, the quality check, the second attempt, and what is kept.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { ModelEntry, Usage } from "@/lib/ai/models";
import { FIXTURE_JUDGE, FIXTURE_MODEL, type ImageMaker, type PictureJudge } from "@/lib/pictures/makers";
import type { Verdict } from "@/lib/pictures/quality";
import { encodePicture, renderPicture, type RenderInput } from "@/lib/pictures/render";
import type { PictureImage } from "@/lib/pictures/studio";

const photo = async (width: number, height: number, colour = "#8a6b4f"): Promise<PictureImage> => ({
  bytes: new Uint8Array(await sharp({ create: { width, height, channels: 3, background: colour } }).jpeg().toBuffer()),
  contentType: "image/jpeg",
});

const GOOD: Verdict = { fidelity: 9, realism: 8, scale: 8, roomKept: 9, issues: [] };
const POOR: Verdict = { fidelity: 5, realism: 6, scale: 8, roomKept: 9, issues: ["the back legs are missing: show four tapered legs", "the shadow is missing under the seat"] };
const BETTER_BUT_POOR: Verdict = { fidelity: 6, realism: 6, scale: 8, roomKept: 9, issues: [] };

/** A maker that hands back a picture of its own and remembers what it was asked. */
function recordingMaker(outcomes: ("image" | "refuse")[] = []) {
  const asked: { prompt: string; images: number; aspectRatio: string; size: string; sizes: number[] }[] = [];
  const maker: ImageMaker = {
    entry: FIXTURE_MODEL,
    async make({ prompt, images, aspectRatio, size }) {
      const sizes = await Promise.all(images.map(async (image) => Math.max((await sharp(Buffer.from(image.bytes)).metadata()).width!, (await sharp(Buffer.from(image.bytes)).metadata()).height!)));
      asked.push({ prompt, images: images.length, aspectRatio, size, sizes });
      if (outcomes[asked.length - 1] === "refuse") return { ok: false, reason: "model_refused", detail: "no image returned", calls: [{ entry: FIXTURE_MODEL, usage: { units: 0, inputTokens: 900 } }] };
      return { ok: true, image: await photo(2400, 1792, asked.length === 1 ? "#405060" : "#605040"), entry: FIXTURE_MODEL, calls: [{ entry: FIXTURE_MODEL, usage: { units: 1, inputTokens: 5_000, outputTokens: 1_000 } }] };
    },
  };
  return { maker, asked };
}

/** A judge that answers from a script, one verdict per look. */
function scriptedJudge(verdicts: (Verdict | null)[]) {
  const looked: { prompt: string; images: number }[] = [];
  const judge: PictureJudge = {
    entry: FIXTURE_JUDGE,
    async judge({ prompt, images }) {
      looked.push({ prompt, images: images.length });
      return { verdict: verdicts[looked.length - 1] ?? null, usage: { inputTokens: 2_000, outputTokens: 100 } };
    },
  };
  return { judge, looked };
}

function spending() {
  const calls: { entry: ModelEntry; usage: Usage }[] = [];
  return { calls, spend: async (entry: ModelEntry, usage: Usage) => void calls.push({ entry, usage }) };
}

const SOFA = { title: "Canova 3-Seater Maxi", kindLabel: "Sofa", dimsCm: { w: 233, d: 102, h: 93 } };

async function input(patch: Partial<RenderInput> = {}): Promise<RenderInput> {
  return {
    kind: "quick",
    piece: SOFA,
    style: null,
    roomType: "living",
    room: await photo(4032, 3024),
    references: [await photo(1536, 1536, "#ffffff"), await photo(1200, 1200, "#ffffff")],
    detail: await photo(1536, 1100, "#ffffff"),
    ...patch,
  };
}

describe("renderPicture (docs/adr/060)", () => {
  it("sends the room, the piece's photographs and its close crop, asks for 2K in the room's own framing, and keeps a picture that passes", async () => {
    const { maker, asked } = recordingMaker();
    const { judge, looked } = scriptedJudge([GOOD]);
    const { calls, spend } = spending();
    const result = await renderPicture({ maker, judge, spend }, await input());
    expect(result).toMatchObject({ ok: true, attempts: 1, verdict: GOOD, promptVersion: "picture-v2" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ images: 4, aspectRatio: "4:3", size: "2K" });
    // The phone's 4032 px photograph is sent at 2560; the piece's photographs as they were given.
    expect(asked[0]!.sizes).toEqual([2560, 1536, 1200, 1536]);
    expect(asked[0]!.prompt).toContain("Image 1 is their room: keep it");
    // The check sees the picture, two of the piece's photographs and the room.
    expect(looked).toEqual([{ prompt: expect.stringContaining("Image 4 is the room photograph"), images: 4 }]);
    // Every call is paid for as it happens: the picture, then its check.
    expect(calls.map((call) => call.entry.id)).toEqual([FIXTURE_MODEL.id, FIXTURE_JUDGE.id]);
  });

  it("makes a falling-short picture once more, with the check's corrections, and keeps the second when it passes", async () => {
    const { maker, asked } = recordingMaker();
    const { judge } = scriptedJudge([POOR, GOOD]);
    const { calls, spend } = spending();
    const result = await renderPicture({ maker, judge, spend }, await input());
    expect(result).toMatchObject({ ok: true, attempts: 2, verdict: GOOD });
    expect(asked).toHaveLength(2);
    expect(asked[0]!.prompt).not.toContain("A first attempt");
    expect(asked[1]!.prompt).toContain("(the back legs are missing: show four tapered legs)");
    expect(asked[1]!.prompt).toContain("(the shadow is missing under the seat)");
    expect(calls).toHaveLength(4);
  });

  it("fails as 'quality' when neither attempt clears the bar, keeping the better verdict for the record", async () => {
    const { maker } = recordingMaker();
    const { judge } = scriptedJudge([POOR, BETTER_BUT_POOR]);
    const { spend } = spending();
    const result = await renderPicture({ maker, judge, spend }, await input());
    expect(result).toEqual({ ok: false, reason: "quality", attempts: 2, verdict: BETTER_BUT_POOR, notes: [] });
  });

  it("keeps the first picture if the second is refused, only when the first passed — otherwise fails as 'quality'", async () => {
    const { maker } = recordingMaker(["image", "refuse"]);
    const { judge } = scriptedJudge([POOR]);
    const { spend } = spending();
    expect(await renderPicture({ maker, judge, spend }, await input())).toMatchObject({ ok: false, reason: "quality", attempts: 2 });
  });

  it("pays for every call under the model that served it, and records which model made the picture", async () => {
    const pro = { ...FIXTURE_MODEL, id: "pro-stand-in" };
    const flash = { ...FIXTURE_MODEL, id: "flash-stand-in" };
    // A chain: the first model refused the request, the second made the picture.
    const maker: ImageMaker = {
      entry: pro,
      make: async () => ({
        ok: true,
        image: await photo(2048, 1536),
        entry: flash,
        calls: [
          { entry: pro, usage: { units: 0 } },
          { entry: flash, usage: { units: 1, inputTokens: 4_000 } },
        ],
      }),
    };
    const { calls, spend } = spending();
    const result = await renderPicture({ maker, judge: scriptedJudge([GOOD]).judge, spend }, await input());
    expect(result).toMatchObject({ ok: true, model: flash, notes: ["made by flash-stand-in after 1 failed call(s)"] });
    expect(calls.map((call) => call.entry.id)).toEqual(["pro-stand-in", "flash-stand-in", FIXTURE_JUDGE.id]);
  });

  it("keeps a picture the check could not answer about, rather than throw away a paid one", async () => {
    const { maker } = recordingMaker();
    const { judge } = scriptedJudge([null]);
    const { spend } = spending();
    expect(await renderPicture({ maker, judge, spend }, await input())).toMatchObject({ ok: true, attempts: 1, verdict: null });
  });

  it("reports a refusal on the first attempt and spends nothing more", async () => {
    const { maker, asked } = recordingMaker(["refuse"]);
    const { judge, looked } = scriptedJudge([GOOD]);
    const { calls, spend } = spending();
    expect(await renderPicture({ maker, judge, spend }, await input())).toEqual({ ok: false, reason: "model_refused", attempts: 1, verdict: null, notes: ["model_refused: no image returned"] });
    expect(asked).toHaveLength(1);
    expect(looked).toHaveLength(0);
    // What the refusal read is still recorded.
    expect(calls).toEqual([{ entry: FIXTURE_MODEL, usage: { units: 0, inputTokens: 900 } }]);
  });

  it("frames a showroom scene at 4:3 in the style's room photograph, or has the model make the room when there is none", async () => {
    const withRoom = recordingMaker();
    const scene = { kind: "scene" as const, style: "scandinavian" as const, room: await photo(4096, 3072), detail: null };
    await renderPicture({ maker: withRoom.maker, judge: scriptedJudge([GOOD]).judge, spend: spending().spend }, await input(scene));
    expect(withRoom.asked[0]).toMatchObject({ images: 3, aspectRatio: "4:3" });
    expect(withRoom.asked[0]!.prompt).toContain("Image 1 is the room, a real photograph taken for this purpose");

    const bare = recordingMaker();
    const judged = scriptedJudge([GOOD]);
    await renderPicture({ maker: bare.maker, judge: judged.judge, spend: spending().spend }, await input({ ...scene, room: null }));
    expect(bare.asked[0]).toMatchObject({ images: 2, aspectRatio: "4:3" });
    expect(bare.asked[0]!.prompt).toContain("You are photographing a product");
    // A scene has no shopper's room for the check to compare with.
    expect(judged.looked[0]!.images).toBe(3);
    expect(judged.looked[0]!.prompt).toContain("roomKept — answer null");
  });

  it("keeps a portrait photograph's framing", async () => {
    const { maker, asked } = recordingMaker();
    await renderPicture({ maker, judge: null, spend: spending().spend }, await input({ room: await photo(3024, 4032) }));
    expect(asked[0]!.aspectRatio).toBe("3:4");
  });

  it("refuses without a room for a shopper's picture, or without any photograph of the piece", async () => {
    const { maker, asked } = recordingMaker();
    const deps = { maker, judge: null, spend: spending().spend };
    expect(await renderPicture(deps, await input({ room: null }))).toMatchObject({ ok: false, reason: "no_room" });
    expect(await renderPicture(deps, await input({ references: [] }))).toMatchObject({ ok: false, reason: "no_references" });
    expect(await renderPicture(deps, await input({ room: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" } }))).toMatchObject({ ok: false, reason: "unreadable" });
    expect(asked).toHaveLength(0);
  });
});

describe("encodePicture", () => {
  it("stores the picture at up to 2560 px, a 1024 px copy and a full-size JPEG to save", async () => {
    const made = await photo(2752, 1536);
    const files = await encodePicture(made);
    const [result, preview, download] = await Promise.all([files.result, files.preview, files.download].map((bytes) => sharp(Buffer.from(bytes)).metadata()));
    expect([result!.format, result!.width, result!.height]).toEqual(["webp", 2560, 1429]);
    expect([preview!.format, preview!.width]).toEqual(["webp", 1024]);
    expect([download!.format, download!.width]).toEqual(["jpeg", 2560]);
    expect({ width: files.width, height: files.height }).toEqual({ width: 2560, height: 1429 });
    // A 2K picture smaller than the cap is never enlarged.
    expect((await sharp(Buffer.from((await encodePicture(await photo(2048, 1536))).result)).metadata()).width).toBe(2048);
  });
});
