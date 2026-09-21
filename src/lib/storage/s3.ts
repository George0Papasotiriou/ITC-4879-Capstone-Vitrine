/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * S3-compatible storage driver using presigned URLs.
 */

import type { S3Client } from "@aws-sdk/client-s3";

import type { ServerEnv } from "@/env";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * The production storage driver: an S3-compatible bucket, reached only through
 * presigned URLs (docs/PLAN.md 2.8).
 *
 * Nothing reads or writes the bucket through the application server: browsers
 * upload with a presigned PUT and read with a presigned GET. Large files stay
 * off the request path, and an upload limit is enforced by the signature rather
 * than by trust.
 */

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * The environment contract already requires these when the s3 driver is
 * selected; this turns that guarantee into a type, once, so nothing below has
 * to handle a missing credential.
 */
function s3Config(env: ServerEnv): S3Config {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (S3_ENDPOINT === undefined || S3_BUCKET === undefined || S3_ACCESS_KEY_ID === undefined || S3_SECRET_ACCESS_KEY === undefined) {
    throw new Error("The s3 storage driver was selected without S3 credentials.");
  }
  return {
    endpoint: S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

export async function createS3Driver(env: ServerEnv): Promise<StorageDriver> {
  const config = s3Config(env);
  const [
    { S3Client: Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand },
    { getSignedUrl },
  ] = await Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner")]);

  const client: S3Client = new Client({
    region: config.region,
    endpoint: config.endpoint,
    // S3-compatible providers generally need path-style addressing, because
    // virtual-host style requires per-bucket DNS.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    kind: "s3",
    presignedUploadUrl: ({ key, contentType, expiresInSeconds = 300 }) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }), {
        expiresIn: expiresInSeconds,
      }),
    presignedDownloadUrl: ({ key, expiresInSeconds = 300 }) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      }),
    putObject: async ({ key, body, contentType }) => {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    getObject: async (key) => {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (response.Body === undefined) return null;
        return {
          body: await response.Body.transformToByteArray(),
          contentType: response.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") return null;
        throw error;
      }
    },
    deleteObject: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    check: async () => {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { location: config.bucket };
    },
  };
}
