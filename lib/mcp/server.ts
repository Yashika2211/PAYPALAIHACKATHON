import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { formatUsd } from "@/lib/money";
import { runNegotiation } from "@/lib/negotiation/engine";
import { autoApprove } from "@/lib/orders";
import { createRfq, getSnapshot } from "@/lib/rfqs";

/*
 * Haggle as an MCP server: any AI agent (Claude, ChatGPT, a custom agent) can
 * discover Haggle's small-business merchants and buy from them, under exactly
 * the same rules as Haggle's own buyer agent. Agents can never sign a mandate:
 * spending authority is granted by a human at the returned link, and every
 * negotiation step and payment is checked by the Mandate Firewall.
 */

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ ...text(message), isError: true });

/** Negotiations run in the background; MCP clients poll get_request_status. */
const running = new Set<string>();

export function createHaggleMcpServer(baseUrl: string) {
  const server = new McpServer(
    { name: "haggle", version: "1.0.0" },
    {
      instructions:
        "Haggle is a marketplace of small-business AI sales agents with PayPal escrow. Typical flow: list_merchants → request_quotes (returns a mandate link the human must open and sign) → start_negotiation → poll get_request_status → pay. You cannot grant yourself spending authority; only a signed mandate can.",
    },
  );

  server.registerTool(
    "list_merchants",
    {
      title: "List merchants",
      description: "List live Haggle merchants and their public catalogs (list prices only; floors are private). Optionally filter by category.",
      inputSchema: { category: z.string().optional().describe("e.g. catering, bakery, printing, flowers") },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => {
      const merchants = await db.query.merchants.findMany({
        where: category ? and(eq(schema.merchants.status, "live"), eq(schema.merchants.category, category.toLowerCase())) : eq(schema.merchants.status, "live"),
      });
      const items = merchants.length
        ? await db.query.catalogItems.findMany({ where: inArray(schema.catalogItems.merchantId, merchants.map((m) => m.id)) })
        : [];
      return text(
        merchants
          .filter((m) => !m.isRogue || process.env.DEMO_MODE === "true")
          .map((m) => ({
            name: m.name,
            category: m.category,
            tagline: m.tagline,
            lead_time_hours: m.leadTimeHours,
            catalog: items
              .filter((i) => i.merchantId === m.id)
              .map((i) => ({ item: i.name, unit: i.unit, list_price: formatUsd(i.listPriceCents), dietary: i.dietaryTags })),
          })),
      );
    },
  );

  server.registerTool(
    "request_quotes",
    {
      title: "Request quotes",
      description:
        "Describe what you need in one sentence. Haggle plans line items and returns a mandate link: the human buyer must open it and sign a spending mandate before any negotiation or payment can happen.",
      inputSchema: { request: z.string().min(8).describe("e.g. 'Catering plus name badges for 40 people this Friday, half vegetarian, under $800'") },
    },
    async ({ request }) => {
      try {
        const { rfqId, plan } = await createRfq(request, { source: "mcp" });
        return text({
          request_id: rfqId,
          plan: plan.needs,
          budget: plan.budgetCents ? formatUsd(plan.budgetCents) : null,
          next_step: "Ask the human buyer to open mandate_url and sign the spending mandate, then call start_negotiation.",
          mandate_url: `${baseUrl}/buy/${rfqId}`,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "start_negotiation",
    {
      title: "Start negotiation",
      description: "Start parallel negotiations with every relevant merchant agent. Requires a mandate the human has signed.",
      inputSchema: { request_id: z.string().uuid() },
    },
    async ({ request_id }) => {
      const mandate = await db.query.mandates.findFirst({
        where: and(eq(schema.mandates.rfqId, request_id), eq(schema.mandates.status, "active")),
        orderBy: desc(schema.mandates.createdAt),
      });
      if (!mandate) return fail(`No signed mandate yet. The human buyer must sign it at ${baseUrl}/buy/${request_id}`);
      const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, request_id) });
      if (rfq?.status !== "planning" || running.has(request_id)) return text({ status: rfq?.status ?? "unknown", note: "Negotiation already started; poll get_request_status." });
      running.add(request_id);
      runNegotiation(request_id)
        .catch((err) => console.error("[mcp] negotiation", err))
        .finally(() => running.delete(request_id));
      return text({ status: "negotiating", note: "Poll get_request_status every few seconds.", watch_live: `${baseUrl}/buy/${request_id}` });
    },
  );

  server.registerTool(
    "get_request_status",
    {
      title: "Get request status",
      description: "Negotiation progress, the chosen bundle with the agent's rationale, firewall decisions, and payment/settlement state.",
      inputSchema: { request_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ request_id }) => {
      try {
        const s = await getSnapshot(request_id);
        const negotiations = await db.query.negotiations.findMany({ where: eq(schema.negotiations.rfqId, request_id) });
        const decisions = await db.query.firewallDecisions.findMany({ where: eq(schema.firewallDecisions.rfqId, request_id) });
        const names = new Map(s.merchants.map((m) => [m.id, m.name]));
        return text({
          request: s.rfq.rawRequest,
          status: s.rfq.status,
          mandate: s.mandate
            ? { status: s.mandate.status, cap: formatUsd(s.mandate.budgetCapCents), auto_approve_up_to: formatUsd(s.mandate.approvalThresholdCents), held: formatUsd(s.mandate.spentCents) }
            : { status: "unsigned", sign_at: `${baseUrl}/buy/${request_id}` },
          negotiations: negotiations.map((n) => ({ merchant: names.get(n.merchantId), status: n.status, rounds: n.roundCount })),
          firewall: { allowed: decisions.filter((d) => d.decision === "allow").length, denied: decisions.filter((d) => d.decision === "deny").map((d) => ({ actor: d.actor, reasons: d.reasons })) },
          bundle: s.order
            ? {
                order_id: s.order.id,
                state: s.order.state,
                total: formatUsd(s.order.totalCents),
                saved_vs_first_quotes: s.order.firstQuoteTotalCents ? formatUsd(s.order.firstQuoteTotalCents - s.order.totalCents) : null,
                rationale: s.order.rationale,
                lines: s.allocations.map((a) => ({ description: a.description, amount: formatUsd(a.amountCents), state: a.state })),
                paid_by: s.order.paymentMethod,
                agent_paid: s.order.autoApproved,
              }
            : null,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "pay_for_bundle",
    {
      title: "Pay for bundle",
      description:
        "Ask to pay for the chosen bundle with the buyer's saved PayPal Vault method. Funds are only held (authorized) until each merchant delivers. Allowed only within the mandate's auto-approve limit; otherwise the human must approve at the returned link.",
      inputSchema: { request_id: z.string().uuid() },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ request_id }) => {
      const order = await db.query.orders.findFirst({ where: eq(schema.orders.rfqId, request_id), orderBy: desc(schema.orders.createdAt) });
      if (!order) return fail("No bundle yet. Wait until get_request_status shows a bundle.");
      if (order.state !== "mandate_signed") return text({ state: order.state, note: "Already paid or settled." });
      try {
        const r = await autoApprove(order.id);
        switch (r.status) {
          case "authorized":
            return text({ status: "authorized", amount: formatUsd(order.totalCents), note: "Funds are held on PayPal, not charged. Each merchant is paid after verified delivery." });
          case "needs_human":
            return text({ status: "needs_human_approval", reasons: r.reasons, approve_at: `${baseUrl}/buy/${request_id}` });
          case "no_saved_method":
            return text({ status: "needs_human_approval", reasons: ["the buyer has no saved PayPal method for agent payments"], approve_at: `${baseUrl}/buy/${request_id}` });
          default:
            return fail(`Mandate Firewall: ${(r.reasons ?? [r.status]).join("; ")}`);
        }
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}
