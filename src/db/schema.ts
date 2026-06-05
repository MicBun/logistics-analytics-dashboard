import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
} from "drizzle-orm/pg-core";

/**
 * Order lifecycle status.
 *
 * Explicit categorization (drives all KPI math — see src/lib/metrics.ts):
 * - Delivered (terminal, success):        'delivered'
 * - Problem   (terminal, not on-time):    'delayed', 'exception'
 * - Canceled  (terminal, never fulfilled):'canceled'
 * - In-flight (no outcome yet):           'in_transit'
 *
 * Note: 'delayed' is a derived/simplified state in this dataset. Real carrier
 * systems express lateness via an exception or a revised ETA rather than a
 * native "delayed" status; the dataset has pre-computed it for us. We take it
 * from the status field as-is and never invent an SLA/date-derived threshold
 * (the dataset has no promised/committed delivery date).
 */
export const orderStatusEnum = pgEnum("order_status", [
  "delivered",
  "delayed",
  "in_transit",
  "exception",
  "canceled",
]);

/**
 * Unified logistics orders table — the single dataset behind both the
 * dashboard and the NL query interface. Seeded once from
 * data/mock_logistics_data.csv (400 rows, 2025-01-01 → 2025-12-30) and
 * read-only at runtime: there are no write paths in the application.
 *
 * Data facts the code relies on:
 * - delivery_date is NULL exactly for in_transit (27) and canceled (3) orders.
 * - order_value_usd = quantity × unit_price_usd (gross — promo discount NOT applied).
 * - is_promo is 0/1 in the CSV; stored as boolean here.
 */
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),
  orderId: text("order_id").notNull().unique(),
  orderDate: date("order_date").notNull(),
  deliveryDate: date("delivery_date"), // NULL for in_transit + canceled
  carrier: text("carrier").notNull(),
  originCity: text("origin_city").notNull(),
  destinationCity: text("destination_city").notNull(),
  status: orderStatusEnum("status").notNull(),
  sku: text("sku").notNull(),
  productCategory: text("product_category").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceUsd: numeric("unit_price_usd", { precision: 10, scale: 2 }).notNull(),
  orderValueUsd: numeric("order_value_usd", { precision: 12, scale: 2 }).notNull(),
  isPromo: boolean("is_promo").notNull().default(false),
  promoDiscountPct: integer("promo_discount_pct").notNull().default(0),
  region: text("region").notNull(),
  warehouse: text("warehouse").notNull(),
});

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
