/**
 * One-time seed: load data/mock_logistics_data.csv into the Neon `orders` table.
 *
 * Run with: pnpm db:seed   (never at runtime — the dataset is read-only in the app)
 *
 * Idempotent by design: it wipes the table before inserting, so re-running it
 * always yields the same 400 rows. After loading it VERIFIES the data against
 * the known dataset facts (counts + headline KPIs) and exits non-zero on any
 * mismatch — this is the data-correctness insurance for everything downstream.
 */

// --- ENV TRAP -------------------------------------------------------------
// dotenv must populate process.env BEFORE the db client reads DATABASE_URL.
// `import` statements are hoisted to the top of the module and run before any
// top-level call, so a static `import { getDb } from "@/db/client"` would
// evaluate the client (and throw on a missing DATABASE_URL) before this config
// call runs. We therefore (1) call config() first and (2) import getDb lazily
// with a dynamic import() inside main(), which executes in program order.
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "csv-parse/sync";
import { count, eq, isNull, sql } from "drizzle-orm";

import { orders, type NewOrderRow } from "@/db/schema";
import { STATUSES, type Status } from "@/lib/catalog";

// Type-only import is erased at compile time, so it does NOT trigger the env
// trap (no runtime evaluation of the client). It just types the `db` handle.
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;

const CSV_PATH = join(process.cwd(), "data", "mock_logistics_data.csv");
const CHUNK_SIZE = 50; // neon-http has a per-request payload limit; chunk inserts.

/** Expected dataset facts — re-confirmed on every load (see docs/.plan.md §3). */
const EXPECTED = {
  total: 400,
  byStatus: {
    delivered: 304,
    delayed: 55,
    in_transit: 27,
    exception: 11,
    canceled: 3,
  } satisfies Record<Status, number>,
  nullDeliveryDates: 30, // in_transit (27) + canceled (3)
  onTimeRate: 0.847, // delivered / (delivered + delayed) = 304 / 359
  avgDeliveryDays: 3.25, // Σ delivered (delivery_date − order_date) / 304 = 988 / 304
};

/** Raw CSV row — all values arrive as strings (or '' for empties). */
interface CsvRow {
  client_id: string;
  order_id: string;
  order_date: string;
  delivery_date: string;
  carrier: string;
  origin_city: string;
  destination_city: string;
  status: string;
  sku: string;
  product_category: string;
  quantity: string;
  unit_price_usd: string;
  order_value_usd: string;
  is_promo: string;
  promo_discount_pct: string;
  region: string;
  warehouse: string;
}

/**
 * Map a CSV row to a Drizzle insert row.
 *
 * Type rules that matter:
 * - date columns take 'YYYY-MM-DD' strings; an empty delivery_date → null
 *   (true for exactly the in_transit + canceled orders).
 * - numeric() columns (unit_price_usd, order_value_usd) take STRINGS — passing a
 *   JS number would lose precision / be rejected by the driver. Keep them as-is.
 * - quantity / promo_discount_pct are integers → Number().
 * - is_promo is '1'/'0' in the CSV → boolean.
 */
function toRow(r: CsvRow): NewOrderRow {
  return {
    clientId: r.client_id,
    orderId: r.order_id,
    orderDate: r.order_date,
    deliveryDate: r.delivery_date === "" ? null : r.delivery_date,
    carrier: r.carrier,
    originCity: r.origin_city,
    destinationCity: r.destination_city,
    status: r.status as Status,
    sku: r.sku,
    productCategory: r.product_category,
    quantity: Number(r.quantity),
    unitPriceUsd: r.unit_price_usd, // numeric → keep string
    orderValueUsd: r.order_value_usd, // numeric → keep string
    isPromo: r.is_promo === "1",
    promoDiscountPct: Number(r.promo_discount_pct),
    region: r.region,
    warehouse: r.warehouse,
  };
}

/** Fail loudly: log every mismatch found by verify(), then exit non-zero. */
function fail(errors: string[]): never {
  console.error("\n❌ Seed verification FAILED:");
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}

async function main() {
  // Lazy import so the env trap above runs first (see ENV TRAP note).
  const { getDb } = await import("@/db/client");
  const db = getDb();

  console.log(`Reading ${CSV_PATH} ...`);
  const csv = readFileSync(CSV_PATH, "utf8");
  const records = parse(csv, { columns: true }) as CsvRow[];
  const rows = records.map(toRow);
  console.log(`Parsed ${rows.length} rows from CSV.`);

  // Idempotent: clear the table so re-running converges to the same state.
  console.log("Clearing existing rows ...");
  await db.delete(orders);

  console.log(`Inserting in chunks of ${CHUNK_SIZE} ...`);
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db.insert(orders).values(rows.slice(i, i + CHUNK_SIZE));
  }
  console.log("Insert complete. Verifying ...");

  await verify(db);
}

async function verify(db: Db) {
  const errors: string[] = [];

  // Total count.
  const [{ total }] = await db.select({ total: count() }).from(orders);
  if (total !== EXPECTED.total) {
    errors.push(`total = ${total}, expected ${EXPECTED.total}`);
  }

  // Count per status (one grouped query).
  const statusRows = await db
    .select({ status: orders.status, n: count() })
    .from(orders)
    .groupBy(orders.status);
  const byStatus = Object.fromEntries(
    statusRows.map((r) => [r.status, r.n]),
  ) as Record<Status, number>;
  for (const s of STATUSES) {
    const got = byStatus[s] ?? 0;
    if (got !== EXPECTED.byStatus[s]) {
      errors.push(`status '${s}' = ${got}, expected ${EXPECTED.byStatus[s]}`);
    }
  }

  // Null delivery_date count (must equal in_transit + canceled).
  const [{ nulls }] = await db
    .select({ nulls: count() })
    .from(orders)
    .where(isNull(orders.deliveryDate));
  if (nulls !== EXPECTED.nullDeliveryDates) {
    errors.push(
      `null delivery_date = ${nulls}, expected ${EXPECTED.nullDeliveryDates}`,
    );
  }

  // Headline KPIs computed FROM THE DB (not the CSV) — proves the round-trip.
  const delivered = byStatus.delivered ?? 0;
  const delayed = byStatus.delayed ?? 0;
  const onTimeRate = delivered / (delivered + delayed);

  // avg delivery days over delivered rows: AVG(delivery_date − order_date).
  // In Postgres `date - date` evaluates to an integer number of days, so the
  // average is a plain numeric (returned as a string by neon-http → Number()).
  // Delivered rows always have a delivery_date, so no null handling is needed.
  const [{ avgDays }] = await db
    .select({
      avgDays: sql<number>`avg(${orders.deliveryDate} - ${orders.orderDate})`,
    })
    .from(orders)
    .where(eq(orders.status, "delivered"));
  const avgDeliveryDays = Number(avgDays);

  // Compare rounded to the documented precision (avoid float noise).
  if (round3(onTimeRate) !== EXPECTED.onTimeRate) {
    errors.push(
      `on-time rate = ${round3(onTimeRate)}, expected ${EXPECTED.onTimeRate}`,
    );
  }
  if (round2(avgDeliveryDays) !== EXPECTED.avgDeliveryDays) {
    errors.push(
      `avg delivery days = ${round2(avgDeliveryDays)}, expected ${EXPECTED.avgDeliveryDays}`,
    );
  }

  if (errors.length > 0) fail(errors);

  // Success summary.
  console.log("\n✅ Seed verified. Summary:");
  console.table({
    "total orders": total,
    delivered,
    delayed,
    in_transit: byStatus.in_transit ?? 0,
    exception: byStatus.exception ?? 0,
    canceled: byStatus.canceled ?? 0,
    "null delivery_date": nulls,
    "on-time rate": `${(onTimeRate * 100).toFixed(1)}%`,
    "avg delivery days (delivered)": avgDeliveryDays.toFixed(2),
  });
  process.exit(0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
