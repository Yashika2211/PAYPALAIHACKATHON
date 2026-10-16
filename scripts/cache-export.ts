import { writeFileSync } from "node:fs";
import { like } from "drizzle-orm";
import { db, schema, sql } from "../lib/db/client";

// Exports real AI answers for the bundled demo samples (stable keys) so a fresh
// deployment can replay them when the free AI quota is exhausted. Loaded by seed.
async function main() {
  const rows = await db.select().from(schema.llmCache).where(like(schema.llmCache.key, "k:%"));
  writeFileSync("scripts/fixtures/llm-cache.json", JSON.stringify(rows.map(({ key, value, model }) => ({ key, value, model })), null, 2) + "\n");
  console.log(`exported ${rows.length} cached answer(s)`);
  await sql.end();
}
main();
