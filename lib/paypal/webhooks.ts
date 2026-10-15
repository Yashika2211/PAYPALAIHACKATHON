import { paypalRequest } from "./client";

export const SUBSCRIBED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
] as const;

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: Record<string, unknown> & { id?: string };
  create_time?: string;
}

/** Verifies a webhook with PayPal's /v1/notifications/verify-webhook-signature. */
export async function verifyWebhookSignature(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (name: string) => headers.get(name) ?? "";
  const res = await paypalRequest<{ verification_status: "SUCCESS" | "FAILURE" }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return res.verification_status === "SUCCESS";
}

export function listWebhooks() {
  return paypalRequest<{ webhooks: Array<{ id: string; url: string }> }>({
    method: "GET",
    path: "/v1/notifications/webhooks",
  });
}

export function createWebhook(url: string) {
  return paypalRequest<{ id: string; url: string }>({
    method: "POST",
    path: "/v1/notifications/webhooks",
    body: { url, event_types: SUBSCRIBED_EVENTS.map((name) => ({ name })) },
  });
}

export function updateWebhookUrl(webhookId: string, url: string) {
  return paypalRequest<{ id: string; url: string }>({
    method: "PATCH",
    path: `/v1/notifications/webhooks/${webhookId}`,
    body: [{ op: "replace", path: "/url", value: url }],
  });
}
