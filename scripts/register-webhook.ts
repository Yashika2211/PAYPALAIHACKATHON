import { createWebhook, listWebhooks, updateWebhook } from "../lib/paypal/webhooks";
import { sql } from "../lib/db/client";

// Usage: pnpm webhook:register https://<public-host>
// Creates (or repoints) the sandbox webhook and prints PAYPAL_WEBHOOK_ID.
async function main() {
  const base = process.argv[2]?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) throw new Error("Pass the public https base URL");
  const url = `${base}/api/webhooks/paypal`;
  const { webhooks } = await listWebhooks();
  const existing = webhooks.find((w) => w.url.endsWith("/api/webhooks/paypal"));
  const hook = existing ? await updateWebhook(existing.id, url) : await createWebhook(url);
  console.log(`${existing ? "updated" : "created"} webhook -> ${hook.url}`);
  console.log(`PAYPAL_WEBHOOK_ID=${hook.id}`);
  await sql.end();
}
main().catch(async (e) => {
  console.error(e.message, e.body ? JSON.stringify(e.body) : "");
  await sql.end();
  process.exit(1);
});
