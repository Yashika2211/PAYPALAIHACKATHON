export {};

/**
 * Drives Haggle's MCP server with the official MCP client, the way an external
 * agent (e.g. Claude) would. The human step (signing the mandate) is done over
 * the web API, because MCP clients deliberately cannot do it.
 *
 * Usage: pnpm mcp:smoke [baseUrl]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.argv[2] ?? "http://localhost:3000";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose test client

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const client = new Client({ name: "haggle-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`)));
  const call = async (name: string, args: Json = {}): Promise<Json> => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const raw = r.content[0]?.text ?? "";
    let data: Json;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
    return { ...data, isError: r.isError === true };
  };

  console.log(`Haggle MCP smoke test against ${BASE}/api/mcp\n`);
  const { tools } = await client.listTools();
  check("tools listed", tools.length === 5, tools.map((t) => t.name).join(", "));

  const merchants = await call("list_merchants", { category: "printing" });
  const list = (Object.values(merchants) as unknown[]).filter((m): m is Json => typeof m === "object" && m !== null && "name" in m);
  check("merchants discoverable with public prices only", list.length > 0 && !JSON.stringify(merchants).includes("floor"), list.map((m) => m.name).join(", "));

  const quote = await call("request_quotes", { request: "25 printed name badges for Thursday's board meeting, under $150." });
  check("quote request planned", !!quote.request_id, quote.mandate_url);

  const early = await call("start_negotiation", { request_id: quote.request_id });
  check("agent cannot negotiate before a human signs", early.isError && /No signed mandate/.test(early.message ?? ""));

  // The human signs the mandate in the web app.
  const snap = (await (await fetch(`${BASE}/api/rfqs/${quote.request_id}`)).json()) as Json;
  await fetch(`${BASE}/api/rfqs/${quote.request_id}/mandate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      budgetCapCents: 15_000,
      approvalThresholdCents: 20_000,
      expiresInHours: 24,
      allowedCategories: ["printing"],
      allowedMerchantIds: snap.merchants.map((m: Json) => m.id),
    }),
  });

  const started = await call("start_negotiation", { request_id: quote.request_id });
  check("negotiation started after signing", started.status === "negotiating");

  let status: Json = {};
  for (let i = 0; i < 120; i++) {
    status = await call("get_request_status", { request_id: quote.request_id });
    if (status.bundle || status.status === "closed") break;
    await wait(1000);
  }
  check("bundle reported over MCP", !!status.bundle, status.bundle ? `${status.bundle.total}, saved ${status.bundle.saved_vs_first_quotes}` : status.status);
  check("rogue merchant blocked for MCP buyers too", (status.firewall?.denied ?? []).length > 0, `${status.firewall?.denied?.length ?? 0} denied`);

  const paid = await call("pay_for_bundle", { request_id: quote.request_id });
  check(
    "payment follows the mandate (auto-paid under the limit with a saved method, else asks the human)",
    paid.status === "authorized" || paid.status === "needs_human_approval" || paid.state === "authorized",
    paid.status ?? paid.state,
  );

  await client.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
