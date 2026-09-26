/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shopper's own data: downloaded as a file, or deleted a line at a time or all at once.
 */

import { cookies } from "next/headers";
import { z } from "zod";

import { routing } from "@/i18n/routing";
import { currentUser } from "@/lib/auth/session";
import { COMFORT_COOKIE } from "@/lib/comfort/settings";
import { myData } from "@/lib/prefs/ledger";
import { clearPreferences, preferenceStore } from "@/lib/prefs/server";
import { ACTOR_COOKIE, CONSENT_COOKIE, currentActor, tasteGraph } from "@/lib/reco/server";

/**
 * docs/adr/033. Only ever the person asking: their device's cookies, their
 * account. Deleting a line of history deletes that event and nothing else;
 * "everything" deletes the preferences (device and account), the reading and
 * comfort settings (device and account), the whole history, and turns
 * personal recommendations off — what an account holds for orders stays, as
 * the law asks, and the page says so.
 */

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const locale = new URL(request.url).searchParams.get("locale") === "el" ? "el" : routing.defaultLocale;
  const data = await myData(locale);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="vitrine-my-data-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}

const actionSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("forget-view"), id: z.uuid() }), z.object({ action: z.literal("forget-everything") })]);

export async function POST(request: Request): Promise<Response> {
  const body = actionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  const actor = await currentActor();

  if (body.data.action === "forget-view") {
    const forgotten = actor === null ? false : await tasteGraph().forgetOne(actor, body.data.id);
    return forgotten ? Response.json({ ok: true }) : Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const user = await currentUser();
  await clearPreferences();
  if (user !== null) await preferenceStore().saveComfort(user.id, "");
  if (actor !== null) await tasteGraph().forget(actor);
  const jar = await cookies();
  for (const name of [COMFORT_COOKIE, ACTOR_COOKIE, CONSENT_COOKIE]) jar.delete(name);
  return Response.json({ ok: true });
}
