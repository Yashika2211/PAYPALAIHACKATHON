import { paypalRequest } from "./client";

export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (value: string) => Math.round(Number(value) * 100);

interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  payment_source?: {
    card?: {
      last_digits?: string;
      brand?: string;
      attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } };
    };
  };
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links: Link[];
  purchase_units?: Array<{
    reference_id?: string;
    payments?: {
      authorizations?: Array<{ id: string; status: string; amount: { value: string }; expiration_time?: string }>;
    };
  }>;
}

export interface Authorization {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING";
  amount: { currency_code: string; value: string };
}

export interface Capture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount: { currency_code: string; value: string };
}

export interface OrderLine {
  merchantId: string;
  name: string;
  amountCents: number;
}

/**
 * Orders v2: one AUTHORIZE purchase unit per bundle, one item per merchant.
 * (Multi-unit AUTHORIZE is rejected by PayPal with UNSUPPORTED_INTENT.)
 */
/** Standard sandbox test Visa (also accepted by Vault). Only ever used against the sandbox API. */
export const SANDBOX_TEST_CARD = { number: "4111111111111111", expiry: "2030-12", name: "Haggle Sandbox Buyer", security_code: "123" };

/** How the buyer pays for an AUTHORIZE order. */
export type PaymentSource =
  | { kind: "paypal" }
  | { kind: "card"; saveToVault?: boolean; customerId?: string }
  /** Agent-initiated payment with a saved Vault token (buyer not present). */
  | { kind: "vault"; vaultId: string };

function paymentSourceBody(source: PaymentSource) {
  switch (source.kind) {
    case "paypal":
      return { paypal: { experience_context: { brand_name: "Haggle", shipping_preference: "NO_SHIPPING", user_action: "CONTINUE" } } };
    case "card":
      return {
        card: {
          ...SANDBOX_TEST_CARD,
          ...(source.saveToVault
            ? { attributes: { vault: { store_in_vault: "ON_SUCCESS" }, ...(source.customerId ? { customer: { id: source.customerId } } : {}) } }
            : {}),
        },
      };
    case "vault":
      return {
        card: {
          vault_id: source.vaultId,
          stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" },
        },
      };
  }
}

export function createAuthorizeOrder(args: {
  orderId: string;
  lines: OrderLine[];
  description: string;
  source?: PaymentSource;
}) {
  const source = args.source ?? { kind: "paypal" };
  const total = args.lines.reduce((s, l) => s + l.amountCents, 0);
  return paypalRequest<PayPalOrder>({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: `order-create-${args.orderId}-${source.kind}`,
    orderId: args.orderId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: args.orderId,
          custom_id: args.orderId,
          description: args.description.slice(0, 127),
          soft_descriptor: "HAGGLE",
          amount: {
            currency_code: "USD",
            value: toValue(total),
            breakdown: { item_total: { currency_code: "USD", value: toValue(total) } },
          },
          items: args.lines.map((l) => ({
            name: l.name.slice(0, 127),
            sku: l.merchantId,
            quantity: "1",
            category: "PHYSICAL_GOODS",
            unit_amount: { currency_code: "USD", value: toValue(l.amountCents) },
          })),
        },
      ],
      payment_source: paymentSourceBody(source),
    },
  });
}

export function getOrder(paypalOrderId: string, orderId?: string) {
  return paypalRequest<PayPalOrder>({ method: "GET", path: `/v2/checkout/orders/${paypalOrderId}`, orderId });
}

export function authorizeOrder(paypalOrderId: string, orderId: string) {
  return paypalRequest<PayPalOrder>({
    method: "POST",
    path: `/v2/checkout/orders/${paypalOrderId}/authorize`,
    requestId: `order-authorize-${orderId}`,
    orderId,
    body: {},
  });
}

/** Payments v2: partial capture of one merchant's share. */
export function captureAuthorization(args: {
  authorizationId: string;
  amountCents: number;
  finalCapture: boolean;
  requestId: string;
  invoiceId: string;
  orderId: string;
  note: string;
}) {
  return paypalRequest<Capture>({
    method: "POST",
    path: `/v2/payments/authorizations/${args.authorizationId}/capture`,
    requestId: args.requestId,
    orderId: args.orderId,
    body: {
      amount: { currency_code: "USD", value: toValue(args.amountCents) },
      final_capture: args.finalCapture,
      invoice_id: args.invoiceId,
      note_to_payer: args.note.slice(0, 255),
    },
  });
}

export function getAuthorization(authorizationId: string, orderId?: string) {
  return paypalRequest<Authorization>({
    method: "GET",
    path: `/v2/payments/authorizations/${authorizationId}`,
    orderId,
  });
}

export function voidAuthorization(authorizationId: string, orderId: string) {
  return paypalRequest<Authorization | null>({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/void`,
    requestId: `void-${authorizationId}`,
    orderId,
  });
}

export function reauthorize(authorizationId: string, amountCents: number, orderId: string) {
  return paypalRequest<Authorization>({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/reauthorize`,
    requestId: `reauth-${authorizationId}-${Date.now()}`,
    orderId,
    body: { amount: { currency_code: "USD", value: toValue(amountCents) } },
  });
}

export function refundCapture(captureId: string, amountCents: number, orderId: string, note: string) {
  return paypalRequest<{ id: string; status: string }>({
    method: "POST",
    path: `/v2/payments/captures/${captureId}/refund`,
    requestId: `refund-${captureId}-${amountCents}`,
    orderId,
    body: { amount: { currency_code: "USD", value: toValue(amountCents) }, note_to_payer: note.slice(0, 255) },
  });
}

export interface PayoutBatch {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: Array<{ payout_item_id: string; transaction_status?: string; payout_item: { sender_item_id: string } }>;
}

/** Payouts v1: pay merchants their net share after capture. sender_batch_id dedupes per allocation set. */
export function createPayout(args: {
  senderBatchId: string;
  orderId: string;
  items: Array<{ allocationId: string; email: string; netCents: number; note: string }>;
}) {
  return paypalRequest<PayoutBatch>({
    method: "POST",
    path: "/v1/payments/payouts",
    requestId: args.senderBatchId,
    orderId: args.orderId,
    body: {
      sender_batch_header: {
        sender_batch_id: args.senderBatchId,
        email_subject: "You got paid through Haggle",
        email_message: "Your Haggle order was delivered and captured.",
      },
      items: args.items.map((i) => ({
        recipient_type: "EMAIL",
        receiver: i.email,
        sender_item_id: i.allocationId,
        note: i.note.slice(0, 4000),
        amount: { currency: "USD", value: toValue(i.netCents) },
      })),
    },
  });
}

export function getPayoutBatch(batchId: string, orderId?: string) {
  return paypalRequest<PayoutBatch>({ method: "GET", path: `/v1/payments/payouts/${batchId}`, orderId });
}

// ── Vault v3 ────────────────────────────────────────────────

export interface PaymentToken {
  id: string;
  customer?: { id: string };
  payment_source: { card?: { last_digits?: string; brand?: string; expiry?: string } };
}

export function listPaymentTokens(customerId: string) {
  return paypalRequest<{ payment_tokens?: PaymentToken[] }>({ method: "GET", path: `/v3/vault/payment-tokens?customer_id=${encodeURIComponent(customerId)}` });
}

export function deletePaymentToken(tokenId: string) {
  return paypalRequest<null>({ method: "DELETE", path: `/v3/vault/payment-tokens/${tokenId}` });
}

// ── Invoicing v2 ────────────────────────────────────────────

export interface Invoice {
  id: string;
  status: string;
  detail?: { invoice_number?: string; metadata?: { recipient_view_url?: string } };
  amount?: { value: string };
  links?: Array<{ rel: string; href: string }>;
}

export function getInvoice(invoiceId: string, orderId?: string) {
  return paypalRequest<Invoice>({ method: "GET", path: `/v2/invoicing/invoices/${invoiceId}`, orderId });
}

/** Records an off-PayPal payment (e.g. bank transfer) against an invoice, which marks it paid. */
export function recordInvoicePayment(invoiceId: string, amountCents: number, orderId: string) {
  return paypalRequest<{ payment_id: string }>({
    method: "POST",
    path: `/v2/invoicing/invoices/${invoiceId}/payments`,
    requestId: `invoice-pay-${invoiceId}`,
    orderId,
    body: { method: "BANK_TRANSFER", payment_date: new Date().toISOString().slice(0, 10), amount: { currency_code: "USD", value: toValue(amountCents) }, note: "Recorded by Haggle" },
  });
}

export function cancelInvoice(invoiceId: string, orderId: string) {
  return paypalRequest<null>({
    method: "POST",
    path: `/v2/invoicing/invoices/${invoiceId}/cancel`,
    requestId: `invoice-cancel-${invoiceId}`,
    orderId,
    body: { subject: "Haggle order cancelled", note: "This invoice was cancelled.", send_to_recipient: true, send_to_invoicer: true },
  });
}
