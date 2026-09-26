/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Everything the shop keeps about the person asking, in one place: to read, to download, and to delete.
 */

import { cookies } from "next/headers";

import { currentUser } from "@/lib/auth/session";
import { COMFORT_COOKIE, parseComfort, type Comfort } from "@/lib/comfort/settings";
import { currentPreferences } from "@/lib/prefs/server";
import type { Preferences } from "@/lib/prefs/preferences";
import { currentActor, tasteGraph } from "@/lib/reco/server";

/**
 * docs/adr/033. "What we know about you" is not a policy page: it is the data
 * itself, read from where it is kept, so the page cannot drift from the truth.
 * The same object is the download (GDPR data portability, Article 20): what
 * the shopper sees is exactly what they take away.
 *
 * Orders, reviews and support tickets are not here — they have their own
 * pages under the account, and the law asks the shop to keep orders — but the
 * ledger says where they are.
 */

export type LedgerEntry = { id: string; productId: string; title: string; slug: string; kind: string; at: string };

export type Ledger = {
  exportedAt: string;
  account: { email: string } | null;
  preferences: Preferences;
  preferencesKept: "account" | "device";
  comfort: Comfort;
  personalization: boolean;
  history: LedgerEntry[];
};

export async function myData(locale: "en" | "el"): Promise<Ledger> {
  const [user, prefs, actor, jar] = await Promise.all([currentUser(), currentPreferences(), currentActor(), cookies()]);
  const history = actor === null ? [] : await tasteGraph().history(actor, locale);
  return {
    exportedAt: new Date().toISOString(),
    account: user === null ? null : { email: user.email },
    preferences: prefs.preferences,
    preferencesKept: prefs.source,
    comfort: parseComfort(jar.get(COMFORT_COOKIE)?.value),
    personalization: actor !== null,
    history: history.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
  };
}
