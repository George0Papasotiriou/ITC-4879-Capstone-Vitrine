/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A product's 3D scan is offered only when its file is really in storage.
 */

import type { StorageDriver } from "@/lib/storage/types";

/**
 * docs/adr/035 promised "a piece shows its stand-in shape until its scan is
 * ready, never a broken one". A media row alone does not keep that promise:
 * the first deployment stored scans on the worker's own disk, which the web
 * service cannot read, so every scanned piece's 3D view pointed at a 404
 * (found 2026-09-29). Before a scan is offered, its file is looked up — one
 * HEAD request or stat, remembered for a few minutes per key so a busy
 * product page does not ask every time.
 */

const REMEMBER_MS = 5 * 60_000;
const MAX_REMEMBERED = 2_000;
const MEDIA_PREFIX = "/media/";

type Model = { src: string; bytes: number | null };

export function createStoredModelCheck(files: () => Promise<Pick<StorageDriver, "exists">>, now: () => number = Date.now) {
  const known = new Map<string, { present: boolean; at: number }>();

  return async function storedModel<M extends Model>(model: M | null): Promise<M | null> {
    if (model === null) return null;
    // Only the shop's own storage is checked; nothing else is a stored scan.
    if (!model.src.startsWith(MEDIA_PREFIX)) return null;
    const key = model.src.slice(MEDIA_PREFIX.length);
    const remembered = known.get(key);
    if (remembered !== undefined && now() - remembered.at < REMEMBER_MS) return remembered.present ? model : null;
    let present = false;
    try {
      present = await (await files()).exists(key);
    } catch {
      // Storage unreachable: offer the stand-in rather than a link that may not open.
      present = false;
    }
    known.delete(key);
    known.set(key, { present, at: now() });
    while (known.size > MAX_REMEMBERED) known.delete(known.keys().next().value!);
    return present ? model : null;
  };
}
