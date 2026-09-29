/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for Web Push: RFC 8291's worked example byte for byte, a round trip, VAPID signatures, and send outcomes.
 */

import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from "@/lib/push/webpush";

// RFC 8291, section 5 and Appendix A: "When I grow up, I want to be a watermelon".
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};
const unb64 = (text: string) => Buffer.from(text, "base64url");

/** What a browser does on receipt (the other side of RFC 8291), to check a round trip. */
function decrypt(body: Buffer, uaPrivate: string, uaPublic: string, auth: string): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(unb64(uaPrivate));
  const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
  const zero = Buffer.from([0]);
  const one = Buffer.from([1]);
  const ikm = hmac(hmac(unb64(auth), ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from("WebPush: info"), zero, unb64(uaPublic), asPublic, one]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm"), zero, one])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce"), zero, one])).subarray(0, 12);
  const sealed = body.subarray(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(2);
  return padded.subarray(0, padded.length - 1).toString("utf8");
}

describe("RFC 8291 message encryption", () => {
  it("reproduces the RFC's worked example exactly", () => {
    const body = encryptPayload(unb64(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { asPrivate: RFC.asPrivate, salt: RFC.salt });
    expect(body.subarray(0, 86).toString("base64url")).toBe(RFC.header);
    expect(body.subarray(86).toString("base64url")).toBe(RFC.ciphertext);
  });

  it("is read back by the browser's side, and differs every time for the same words", () => {
    const first = encryptPayload(Buffer.from("Your lamp is on its way"), { p256dh: RFC.uaPublic, auth: RFC.auth });
    const second = encryptPayload(Buffer.from("Your lamp is on its way"), { p256dh: RFC.uaPublic, auth: RFC.auth });
    expect(first.equals(second)).toBe(false);
    expect(decrypt(first, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe("Your lamp is on its way");
  });

  it("refuses keys that are not what a browser gives, and messages over one record", () => {
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: RFC.auth })).toThrow(/P-256/);
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: RFC.uaPublic, auth: "AAAA" })).toThrow(/16 bytes/);
    expect(() => encryptPayload(Buffer.alloc(4096), { p256dh: RFC.uaPublic, auth: RFC.auth })).toThrow(/4 KB/);
  });
});

describe("RFC 8292 VAPID", () => {
  it("signs a short-lived token for the push service's origin that the shop's public key verifies", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:shop@example.com" };
    expect(unb64(keys.publicKey)).toHaveLength(65);
    expect(unb64(keys.privateKey)).toHaveLength(32);
    const now = new Date("2026-09-29T10:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc123", keys, now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(match[4]).toBe(keys.publicKey);
    const claims = JSON.parse(unb64(match[2]!).toString("utf8")) as { aud: string; exp: number; sub: string };
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now.getTime() / 1000 + 12 * 60 * 60, sub: "mailto:shop@example.com" });
    const raw = unb64(keys.publicKey);
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${match[1]}.${match[2]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, unb64(match[3]!))).toBe(true);
  });

  it("never asks for more than a day", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:shop@example.com" };
    const now = new Date("2026-09-29T10:00:00Z");
    const token = vapidAuthorization("https://push.example/x", keys, now, 7 * 24 * 60 * 60).split(".")[1]!;
    expect((JSON.parse(unb64(token).toString("utf8")) as { exp: number }).exp).toBe(now.getTime() / 1000 + 24 * 60 * 60);
  });
});

describe("sending", () => {
  const keys = { ...generateVapidKeys(), subject: "mailto:shop@example.com" };
  const subscription = { endpoint: "https://push.example/send/1", p256dh: RFC.uaPublic, auth: RFC.auth };
  const message = { title: "Price dropped", body: "The lamp is now €39", url: "/en/p/lamp", tag: "watch:lamp" };
  const answering = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;

  it("posts an encrypted body with the headers push services require", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendPush(subscription, message, keys, { fetcher })).toBe("sent");
    const headers = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe(subscription.endpoint);
    expect(headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "normal", topic: "watchlamp" });
    expect(headers.authorization).toMatch(/^vapid t=/);
    const body = Buffer.from(seen!.init.body as Uint8Array);
    expect(JSON.parse(decrypt(body, RFC.uaPrivate, RFC.uaPublic, RFC.auth))).toEqual(message);
  });

  it("reports a subscription the browser dropped as gone, and other answers as failures", async () => {
    expect(await sendPush(subscription, message, keys, { fetcher: answering(410) })).toBe("gone");
    expect(await sendPush(subscription, message, keys, { fetcher: answering(404) })).toBe("gone");
    expect(await sendPush(subscription, message, keys, { fetcher: answering(429) })).toBe("failed");
    expect(await sendPush(subscription, message, keys, { fetcher: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBe("failed");
  });
});
