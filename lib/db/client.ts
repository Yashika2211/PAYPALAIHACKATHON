import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __hagglePg: ReturnType<typeof postgres> | undefined;
}

// Reuse one pool across hot reloads in dev.
const sql =
  globalThis.__hagglePg ??
  postgres(process.env.DATABASE_URL ?? "postgres://haggle:haggle@localhost:5433/haggle", {
    max: 10,
  });
if (process.env.NODE_ENV !== "production") globalThis.__hagglePg = sql;

export const db = drizzle(sql, { schema });
export { sql, schema };
