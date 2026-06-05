import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Neon serverless (HTTP) driver — one fetch per query, no long-lived pool.
 * This is required on Vercel serverless functions to avoid connection
 * exhaustion; do NOT swap in a plain `pg` Pool.
 *
 * Lazily initialized so that importing modules (e.g. in unit tests that only
 * exercise pure functions) does not throw when DATABASE_URL is unset.
 */
let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return drizzle(neon(url), { schema });
}

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
