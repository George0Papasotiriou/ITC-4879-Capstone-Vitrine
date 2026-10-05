/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "On a model like you": four builds and skin tones a shopper chooses from, and the brief FASHN's Product to Model is given for each.
 */

import { slotOf } from "@/lib/fitting/engines";

/**
 * docs/adr/063. A shopper picks the model closest to them instead of uploading
 * a face: nothing personal is sent, and a picture once made is the same for
 * everyone who picks that model, so it is kept and shown again for free.
 *
 * Four presets, chosen to span build and skin tone across the range rather
 * than to stand for any group. A men's piece is worn by a man and a women's
 * piece by a woman, as the listing's department says.
 */
export const MODEL_PRESETS = ["slim-light", "average-medium", "curvy-deep", "tall-olive"] as const;
export type ModelPreset = (typeof MODEL_PRESETS)[number];

const BUILD: Record<ModelPreset, { women: string; men: string }> = {
  "slim-light": { women: "a slim build", men: "a slim build" },
  "average-medium": { women: "an average build", men: "an average build" },
  "curvy-deep": { women: "a curvy, fuller build", men: "a broad, heavier build" },
  "tall-olive": { women: "a tall build", men: "a tall build" },
};
const SKIN: Record<ModelPreset, string> = {
  "slim-light": "light skin",
  "average-medium": "medium skin",
  "curvy-deep": "deep brown skin",
  "tall-olive": "olive skin",
};

export const isModelPreset = (value: string): value is ModelPreset => (MODEL_PRESETS as readonly string[]).includes(value);

/**
 * The brief: who wears it, and a framing that shows the piece. Shoes are seen
 * full length, jewellery and hats from the shoulders up, everything else full
 * length on the shop's plain light ground. The product photograph itself goes
 * as `product_image`; the brief never describes the product, so the model
 * keeps what the photograph shows.
 */
export function modelShotPrompt(preset: ModelPreset, department: "women" | "men", kind: string): string {
  const person = `${department === "women" ? "a woman" : "a man"} with ${BUILD[preset][department]} and ${SKIN[preset]}`;
  const slot = slotOf(kind);
  const framing =
    slot === "accessory" || slot === "head"
      ? "a head-and-shoulders portrait, the piece clearly visible"
      : slot === "feet"
        ? "a full-length photograph, the shoes clearly visible on the feet"
        : "a full-length photograph, standing naturally";
  return `Studio fashion photograph of ${person} wearing the product: ${framing}. Plain light grey background, soft even daylight, true colours, nothing else in the frame.`;
}
