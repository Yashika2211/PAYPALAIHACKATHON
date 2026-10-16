import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { tool } from "ai";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { guard } from "@/lib/firewall";
import { runToolAgent } from "@/lib/llm/provider";
import { formatUsd } from "@/lib/money";
import * as pp from "@/lib/paypal/api";
import { toCents, toValue } from "@/lib/paypal/api";
import { transition } from "@/lib/state/order-machine";

/*
 * Net-terms checkout. A Gemini billing agent drives the PayPal Agent Toolkit's
 * invoicing tools, but it never touches them directly: each call goes through a
 * wrapper that checks the arguments in code against the bundle the buyer approved
 * and through the Mandate Firewall. The model can word the invoice; it cannot
 * change who pays, what is billed, or how much.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the toolkit's tools are AI SDK v4 objects; we only call execute()
type V4Tool = { execute: (args: any, options: any) => Promise<unknown> };

let toolkit: PayPalAgentToolkit | null = null;
function toolkitTools(): Record<string, V4Tool> {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      // Least privilege: the agent only ever gets these two actions.
      actions: { invoices: { create: true, send: true } },
      context: { sandbox: process.env.PAYPAL_ENV !== "live" },
    },
  });
  return toolkit.getTools() as unknown as Record<string, V4Tool>;
}

const callToolkit = (name: string, args: unknown) => toolkitTools()[name].execute(args, { toolCallId: `haggle-${name}`, messages: [] });

export interface BillingResult {
  invoiceId: string;
  agent: string | null;
  recipientViewUrl: string | null;
}

/** Issues and sends a PayPal invoice (Net 15) for an approved bundle. */
export async function issueInvoice(orderId: string): Promise<BillingResult> {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new Error("Order not found");
  if (order.paypalInvoiceId) return { invoiceId: order.paypalInvoiceId, agent: null, recipientViewUrl: null };
  if (order.state !== "mandate_signed") throw new Error(`Order is ${order.state}`);

  const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, order.rfqId) });
  const allocations = await db.query.merchantAllocations.findMany({ where: eq(schema.merchantAllocations.orderId, orderId) });
  const merchants = await db.query.merchants.findMany({ where: inArray(schema.merchants.id, allocations.map((a) => a.merchantId)) });
  const merchantOf = new Map(merchants.map((m) => [m.id, m]));
  const recipient = rfq!.buyerEmail;
  const expected = allocations.map((a) => ({ allocationId: a.id, merchant: merchantOf.get(a.merchantId)!.name, description: a.description, amountCents: a.amountCents }));

  // The buyer's click is the approval. Recorded once, by code.
  const approval = await guard({
    mandateId: order.mandateId,
    rfqId: order.rfqId,
    orderId,
    actor: "human",
    actorLabel: "buyer (pay by invoice)",
    action: {
      type: "request_invoice",
      amountCents: order.totalCents,
      lines: allocations.map((a) => ({ merchantId: a.merchantId, category: merchantOf.get(a.merchantId)!.category, amountCents: a.amountCents })),
      humanApproved: true,
    },
  });
  if (approval.decision !== "allow") throw new Error(`Mandate Firewall: ${approval.reasons.join("; ")}`);

  let invoiceId: string | null = null;
  let sent = false;
  let recipientViewUrl: string | null = null;

  const createInvoice = tool({
    description:
      "Create a draft PayPal invoice for the approved Haggle bundle. Use exactly one item per merchant line, with that line's exact amount, and bill the buyer's email.",
    inputSchema: z.object({
      recipient_email: z.string().describe("The buyer's email address"),
      items: z.array(z.object({ name: z.string().max(200), description: z.string().max(1000).optional(), amount: z.string().describe("Line amount in USD, e.g. 580.00") })).min(1),
      note: z.string().max(4000).describe("A short, friendly note to the buyer"),
    }),
    execute: async (input) => {
      if (invoiceId) return { invoice_id: invoiceId, note: "Already created; send it." };
      // Code checks: the model may phrase the invoice, never change the money or the payer.
      const errors: string[] = [];
      if (input.recipient_email.trim().toLowerCase() !== recipient.toLowerCase()) errors.push(`recipient must be ${recipient}`);
      const want = expected.map((e) => e.amountCents).sort((a, b) => a - b);
      const got = input.items.map((i) => toCents(i.amount)).sort((a, b) => a - b);
      if (want.length !== got.length || want.some((v, i) => v !== got[i])) errors.push(`items must be exactly: ${expected.map((e) => `${e.merchant} ${toValue(e.amountCents)}`).join(", ")}`);
      const decision = await guard({
        mandateId: order.mandateId,
        rfqId: order.rfqId,
        orderId,
        actor: "buyer_agent",
        actorLabel: "billing-agent (create_invoice)",
        action: {
          type: "request_invoice",
          amountCents: got.reduce((s, c) => s + c, 0),
          lines: allocations.map((a) => ({ merchantId: a.merchantId, category: merchantOf.get(a.merchantId)!.category, amountCents: a.amountCents })),
          humanApproved: true,
        },
      });
      if (decision.decision !== "allow") errors.push(...decision.reasons);
      if (errors.length) return { error: `Rejected by Haggle: ${errors.join("; ")}. Fix and call create_invoice again.` };

      const href = String(
        await callToolkit("create_invoice", {
          currency_code: "USD",
          invoice_number: `HG-${orderId.slice(0, 8).toUpperCase()}`,
          invoicer_business_name: "Haggle",
          note: input.note,
          primary_recipients: [{ billing_info: { email_address: recipient } }],
          items: input.items.map((i) => ({ name: i.name.slice(0, 200), description: i.description, quantity: "1", unit_amount: { currency_code: "USD", value: toValue(toCents(i.amount)) } })),
        }),
      );
      const id = /invoices\/(INV2-[A-Z0-9-]+)/.exec(href)?.[1];
      if (!id) return { error: `PayPal did not return an invoice id: ${href.slice(0, 200)}` };
      invoiceId = id;
      try {
        await pp.setInvoiceTerms(id, "NET_15", orderId);
      } catch (err) {
        console.warn("[billing] could not set NET_15 terms:", err instanceof Error ? err.message : err);
      }
      return { invoice_id: id, status: "DRAFT", next: "call send_invoice with this invoice_id" };
    },
  });

  const sendInvoice = tool({
    description: "Send the draft invoice you just created to the buyer.",
    inputSchema: z.object({ invoice_id: z.string(), note: z.string().max(1000).optional() }),
    execute: async (input) => {
      if (!invoiceId || input.invoice_id !== invoiceId) return { error: `You may only send invoice ${invoiceId ?? "(create one first)"}.` };
      if (sent) return { status: "SENT" };
      await callToolkit("send_invoice", { invoice_id: invoiceId, note: input.note, send_to_recipient: true });
      sent = true;
      return { status: "SENT" };
    },
  });

  const run = await runToolAgent({
    tier: "fast",
    system: [
      "You are Haggle's billing agent. A business buyer approved a bundle and chose to pay by PayPal invoice on Net 15 terms.",
      "Call create_invoice once with one item per merchant line (name it after the merchant and what they supply, use the exact amount), then call send_invoice with the returned invoice_id.",
      "If a tool rejects your call, fix exactly what it says and retry. Keep the note to two friendly sentences mentioning Net 15 terms.",
    ].join("\n"),
    prompt: JSON.stringify({ buyer_email: recipient, request: rfq!.rawRequest, total: formatUsd(order.totalCents), lines: expected.map((e) => ({ merchant: e.merchant, supplies: e.description.replace(/^[^:]+:\s*/, ""), amount: toValue(e.amountCents) })) }),
    tools: { create_invoice: createInvoice, send_invoice: sendInvoice },
    maxSteps: 6,
    done: () => sent,
  });

  // Deterministic path: same wrapped tools, called by code, if no model finished the job.
  let agent = run.model;
  if (!sent) {
    agent = null;
    const exec = { toolCallId: "fallback", messages: [] } as never;
    const created = (await createInvoice.execute!(
      {
        recipient_email: recipient,
        items: expected.map((e) => ({ name: e.merchant, description: e.description.replace(/^[^:]+:\s*/, "").slice(0, 900), amount: toValue(e.amountCents) })),
        note: `Thanks for ordering through Haggle. Payment is due on Net 15 terms; each merchant is paid once their delivery is verified.`,
      },
      exec,
    )) as { invoice_id?: string; error?: string };
    if (!created.invoice_id) throw new Error(created.error ?? "Invoice creation failed");
    await sendInvoice.execute!({ invoice_id: created.invoice_id }, exec);
  }

  const invoice = await pp.getInvoice(invoiceId!, orderId);
  recipientViewUrl = invoice.detail?.metadata?.recipient_view_url ?? null;
  await applyInvoiceSent(orderId, invoiceId!);
  await emit(
    "paypal",
    { step: "invoice_sent", invoiceId, amountCents: order.totalCents, invoiceNumber: invoice.detail?.invoice_number ?? null, agent: agent ?? "deterministic", url: recipientViewUrl },
    { rfqId: order.rfqId, orderId },
  );
  return { invoiceId: invoiceId!, agent, recipientViewUrl };
}

async function applyInvoiceSent(orderId: string, invoiceId: string) {
  const current = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!current) return;
  const state = transition(current.state, "invoiced");
  const [order] = await db
    .update(schema.orders)
    .set({ paypalInvoiceId: invoiceId, paymentMethod: "invoice", state })
    .where(eq(schema.orders.id, orderId))
    .returning();
  if (order.mandateId) {
    // An open invoice reserves budget exactly like a hold does.
    await db
      .update(schema.mandates)
      .set({ spentCents: dsql`${schema.mandates.spentCents} + ${order.totalCents}` })
      .where(eq(schema.mandates.id, order.mandateId));
  }
  await emit("order_state", { from: current.state, to: state }, { rfqId: order.rfqId, orderId });
}
