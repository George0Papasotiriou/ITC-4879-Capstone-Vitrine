/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Web Push by the standards alone: the message encrypted for one browser (RFC 8291) and the shop's signature (RFC 8292).
 */

import { createCipheriv, createECDH, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

/**
 * docs/adr/044. A push message travels through the browser maker's push
 * service (Google's, Mozilla's, Apple's), which must not be able to read it.
 * So, as RFC 8291 prescribes, each message is encrypted for the one browser
 * that subscribed:
 *
 * 1. A fresh key pair for this message (as_private, as_public) and the
 *    browser's public key (ua_public) give a shared secret by ECDH on P-256.
 * 2. HKDF (HMAC-SHA-256) mixes that secret with the browser's 16-byte
 *    authentication secret:
 *        PRK_key = HMAC(auth_secret, ecdh_secret)
 *        IKM     = HMAC(PRK_key, "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public ‖ 0x01)
 * 3. RFC 8188 (aes128gcm) turns it, with a random 16-byte salt, into a
 *    content key and a nonce:
 *        PRK   = HMAC(salt, IKM)
 *        CEK   = HMAC(PRK, "Content-Encoding: aes128gcm" ‖ 0x00 ‖ 0x01)[0..16)
 *        NONCE = HMAC(PRK, "Content-Encoding: nonce" ‖ 0x00 ‖ 0x01)[0..12)
 * 4. The message, followed by the delimiter 0x02 (a single, last record), is
 *    sealed with AES-128-GCM. The body is the header — salt, record size 4096,
 *    and as_public as the key id — then the ciphertext and its tag.
 *
 * The push service also needs to know the message comes from this shop
 * (VAPID, RFC 8292): a short JSON Web Token naming the push service's origin
 * and an expiry, signed with ES256 by the shop's own key pair, whose public
 * half the browser was given when it subscribed.
 *
 * Checked in webpush.test.ts against RFC 8291's own worked example, byte for
 * byte, so no library was needed.
 */

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

const RECORD_SIZE = 4096;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");
const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
/** An info string as the RFCs write it: the words, a zero byte, then whatever follows. */
const info = (words: string, ...rest: Uint8Array[]) => Buffer.concat([Buffer.from(words, "utf8"), Buffer.from([0]), ...rest]);
/** One HKDF-Expand block, T(1) = HMAC(PRK, info ‖ 0x01): enough for the 32, 16 and 12 bytes needed here. */
const expand = (prk: Uint8Array, infoBytes: Uint8Array, length: number) => hmac(prk, Buffer.concat([infoBytes, Buffer.from([1])])).subarray(0, length);

/** RFC 8291, section 3.4: the body sent to the push service for one browser. */
export function encryptPayload(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  // Fixed only by the RFC's example in the tests; otherwise fresh for every message.
  fixed?: { asPrivate: string; salt: string },
): Buffer {
  const uaPublic = unb64(subscription.p256dh);
  const authSecret = unb64(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("The browser's key is not an uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("The browser's authentication secret is not 16 bytes");

  const ecdh = createECDH("prime256v1");
  if (fixed === undefined) ecdh.generateKeys();
  else ecdh.setPrivateKey(unb64(fixed.asPrivate));
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = fixed === undefined ? randomBytes(16) : unb64(fixed.salt);

  const prkKey = hmac(authSecret, ecdhSecret);
  const ikm = expand(prkKey, info("WebPush: info", uaPublic, asPublic), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, info("Content-Encoding: aes128gcm"), 16);
  const nonce = expand(prk, info("Content-Encoding: nonce"), 12);

  // One record: the message, the last-record delimiter, and no further padding.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("A push message must fit one 4 KB record");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/** RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>` for one push service, valid for at most a day. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = new Date(), lifetimeSeconds = 12 * 60 * 60): string {
  const publicKey = unb64(vapid.publicKey);
  const header = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + Math.min(lifetimeSeconds, 24 * 60 * 60), sub: vapid.subject })));
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33, 65)) }, format: "jwk" });
  // JWS wants the raw r ‖ s form of the signature, not DER.
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${vapid.publicKey}`;
}

/** A new key pair for the shop, in the forms the browser and the env variables take. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(pub.x!), unb64(pub.y!)])), privateKey: priv.d! };
}

export type PushOutcome = "sent" | "gone" | "failed";

export type PushMessage = {
  title: string;
  body: string;
  /** A page of this shop, opened when the notification is tapped. */
  url: string;
  /** A later message with the same tag replaces the earlier one on the device. */
  tag?: string;
};

/**
 * Sends one message to one browser. 201 is delivered to the push service;
 * 404 and 410 mean the subscription is gone and should be deleted; anything
 * else is a failure to try again another time.
 */
export async function sendPush(
  subscription: PushSubscriptionKeys,
  message: PushMessage,
  vapid: VapidKeys,
  { fetcher = fetch, ttlSeconds = 24 * 60 * 60, urgency = "normal" }: { fetcher?: typeof fetch; ttlSeconds?: number; urgency?: "low" | "normal" | "high" } = {},
): Promise<PushOutcome> {
  const body = encryptPayload(Buffer.from(JSON.stringify(message), "utf8"), subscription);
  const response = await fetcher(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: vapidAuthorization(subscription.endpoint, vapid),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttlSeconds),
      urgency,
      ...(message.tag === undefined ? {} : { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (response === null) return "failed";
  if (response.status === 404 || response.status === 410) return "gone";
  return response.status >= 200 && response.status < 300 ? "sent" : "failed";
}
