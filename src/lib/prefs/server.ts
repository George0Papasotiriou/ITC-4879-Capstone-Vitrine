/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Preferences for pages and route handlers: the device's for a guest, the account's when signed in, and the move from one to the other.
 */

import { cookies } from "next/headers";

import { serverEnv } from "@/env";
import { COMFORT_COOKIE, parseComfort, serializeComfort } from "@/lib/comfort/settings";
import { currentUser } from "@/lib/auth/session";
import { sql } from "@/lib/db/client";
import { applyPatch, EMPTY_PREFERENCES, isEmpty, mergePreferences, preferencesSchema, type Preferences, type PreferencesPatch } from "@/lib/prefs/preferences";
import { createPreferenceStore, type PreferenceStore } from "@/lib/prefs/store";

/**
 * docs/adr/033. A guest's preferences live in a cookie on their device: no
 * account, no server-side row, gone when they clear the browser. Signed in,
 * they live on the account, and whatever the device held is merged in and the
 * cookie removed, so the next person on a shared computer does not inherit a
 * stranger's sizes. Reading never writes; merging happens in route handlers,
 * where cookies can be changed.
 */

export const PREFS_COOKIE = "vt_prefs";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Secure in production, as the shop's other cookies; the local stack serves plain http. */
const secureCookies = () => serverEnv().NODE_ENV === "production" && serverEnv().VITRINE_LOCAL !== true;

let store: PreferenceStore | undefined;
export const preferenceStore = () => (store ??= createPreferenceStore(sql));

function decode(raw: string | undefined): Preferences | null {
  if (raw === undefined || raw === "") return null;
  try {
    const result = preferencesSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const encode = (prefs: Preferences) => Buffer.from(JSON.stringify(prefs), "utf8").toString("base64url");

async function devicePreferences(): Promise<Preferences | null> {
  return decode((await cookies()).get(PREFS_COOKIE)?.value);
}

export type PreferencesView = { preferences: Preferences; source: "account" | "device"; signedIn: boolean };

/** What the shop knows the shopper has said: for pages and route handlers. */
export async function currentPreferences(): Promise<PreferencesView> {
  const user = await currentUser();
  const device = await devicePreferences();
  if (user === null) return { preferences: device ?? EMPTY_PREFERENCES, source: "device", signedIn: false };
  const account = (await preferenceStore().forUser(user.id)).preferences;
  // Until the device's are moved over, both are shown, as they will be kept.
  return { preferences: device === null ? account : mergePreferences(device, account), source: "account", signedIn: true };
}

/** Changes preferences where they are kept. Route handlers only: a guest's are written to their cookie. */
export async function updatePreferences(patch: PreferencesPatch): Promise<PreferencesView> {
  const user = await currentUser();
  const jar = await cookies();
  if (user === null) {
    const next = applyPatch((await devicePreferences()) ?? EMPTY_PREFERENCES, patch);
    if (isEmpty(next)) jar.delete(PREFS_COOKIE);
    else jar.set(PREFS_COOKIE, encode(next), { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: ONE_YEAR });
    return { preferences: next, source: "device", signedIn: false };
  }
  const { preferences: current } = await currentPreferences();
  const saved = await preferenceStore().save(user.id, applyPatch(current, patch));
  jar.delete(PREFS_COOKIE);
  return { preferences: saved, source: "account", signedIn: true };
}

/** Forgets every preference, on the device and on the account. */
export async function clearPreferences(): Promise<void> {
  const user = await currentUser();
  (await cookies()).delete(PREFS_COOKIE);
  if (user !== null) await preferenceStore().save(user.id, EMPTY_PREFERENCES);
}

/**
 * After signing in, and whenever the comfort settings change: the device's
 * preferences go to the account (and leave the device), and the comfort
 * settings meet — a device that has its own keeps them and teaches the
 * account; a new device learns the account's. `changed` says the shopper has
 * just changed them here, so the device's win even when they are back to the
 * defaults (a reset must not be undone by the account). Returns the comfort
 * settings the device should now use, or null to leave them as they are.
 */
export async function syncDevice(deviceComfort: string, { changed = false }: { changed?: boolean } = {}): Promise<{ comfort: string | null; signedIn: boolean }> {
  const user = await currentUser();
  if (user === null) return { comfort: null, signedIn: false };
  const jar = await cookies();
  const device = await devicePreferences();
  const saved = await preferenceStore().forUser(user.id);
  if (device !== null) {
    await preferenceStore().save(user.id, mergePreferences(device, saved.preferences));
    jar.delete(PREFS_COOKIE);
  }
  const local = serializeComfort(parseComfort(deviceComfort));
  if (local !== "" || changed) {
    if (local !== saved.comfort) await preferenceStore().saveComfort(user.id, local);
    return { comfort: null, signedIn: true };
  }
  if (saved.comfort === "") return { comfort: null, signedIn: true };
  jar.set(COMFORT_COOKIE, saved.comfort, { sameSite: "lax", secure: secureCookies(), path: "/", maxAge: ONE_YEAR });
  return { comfort: saved.comfort, signedIn: true };
}
