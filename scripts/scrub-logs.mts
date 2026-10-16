// Re-applies the current redaction rules to every stored PayPal call log. Usage: pnpm logs:scrub
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../lib/db/client";
import { redact } from "../lib/paypal/redact";
async function main() {
const rows = await db.select().from(schema.paypalApiCalls);
let n = 0;
for (const r of rows) {
  const req = redact(r.request) as object | null;
  const res = redact(r.response) as object | null;
  if (JSON.stringify(req) !== JSON.stringify(r.request) || JSON.stringify(res) !== JSON.stringify(r.response)) {
    await db.update(schema.paypalApiCalls).set({ request: req, response: res }).where(eq(schema.paypalApiCalls.id, r.id));
    n++;
  }
}
console.log(`scrubbed ${n}/${rows.length} logged calls`);
await sql.end();
}
main();
