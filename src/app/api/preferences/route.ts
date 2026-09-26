/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shopper's own preferences: read, changed, or forgotten.
 */

import { preferencesPatchSchema } from "@/lib/prefs/preferences";
import { clearPreferences, currentPreferences, updatePreferences, type PreferencesView } from "@/lib/prefs/server";

/**
 * docs/adr/033. Only ever the person asking: a guest's device, or the signed-in
 * account. A change is checked field by field (preferencesPatchSchema); what
 * does not fit is refused with the fields named, never half-saved.
 */

export const runtime = "nodejs";

export type PreferencesResponse = ({ ok: true } & PreferencesView) | { ok: false; reason: "invalid_request"; fields?: string[] };

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, ...(await currentPreferences()) } satisfies PreferencesResponse, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const patch = preferencesPatchSchema.safeParse(await request.json().catch(() => null));
  if (!patch.success) {
    const fields = [...new Set(patch.error.issues.map((issue) => String(issue.path[0] ?? "")))].filter((field) => field !== "");
    return Response.json({ ok: false, reason: "invalid_request", fields } satisfies PreferencesResponse, { status: 400 });
  }
  return Response.json({ ok: true, ...(await updatePreferences(patch.data)) } satisfies PreferencesResponse);
}

export async function DELETE(): Promise<Response> {
  await clearPreferences();
  return Response.json({ ok: true, ...(await currentPreferences()) } satisfies PreferencesResponse);
}
