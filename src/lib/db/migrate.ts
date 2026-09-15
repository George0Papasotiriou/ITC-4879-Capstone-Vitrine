/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Migration runner executed before deployment.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Migration runner.
 *
 * Railway runs this as the pre-deploy command on the `web` service, so a failed
 * migration fails the deployment before traffic is switched to the new version
 * (Phase 1 acceptance criterion).
 *
 * It opens its own single connection rather than reusing the application pool,
 * because it runs as a one-shot process and must exit cleanly.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set; cannot run migrations.");
  }

  const connection = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await migrate(drizzle(connection), { migrationsFolder: "./drizzle" });
    process.stdout.write("Migrations applied.\n");
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${String(error)}\n`);
  process.exit(1);
});
