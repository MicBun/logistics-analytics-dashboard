import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Standalone CLI tool — load env from .env.local (Next.js does this automatically at runtime).
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
