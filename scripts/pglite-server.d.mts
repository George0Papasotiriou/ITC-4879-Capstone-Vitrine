import type { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export function createPgliteServer(options: ConstructorParameters<typeof PGLiteSocketServer>[0]): PGLiteSocketServer;

export function withoutPrematureReady(output: Buffer): { bytes: Buffer; failed: boolean };
