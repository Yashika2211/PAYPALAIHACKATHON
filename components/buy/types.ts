

export interface Need {
  category: string;
  description: string;
  quantity: number;
  vegetarianShare: number;
}
export interface Snapshot {
  vault: null | { brand: string | null; lastDigits: string | null };
  rfq: { id: string; rawRequest: string; status: string; lineItems: Need[]; budgetHintCents: number | null; deadline: string | null };
  merchants: Array<{ id: string; name: string; category: string; status: string; tagline: string; personality: string }>;
  mandate: null | { id: string; status: string; budgetCapCents: number; spentCents: number; approvalThresholdCents: number; expiresAt: string; signature: string };
  order: null | {
    id: string;
    state: string;
    totalCents: number;
    firstQuoteTotalCents: number | null;
    rationale: string;
    paypalOrderId: string | null;
    paypalAuthorizationId: string | null;
    paymentMethod: string | null;
    autoApproved: boolean;
    paypalInvoiceId: string | null;
  };
  allocations: Array<{
    id: string;
    merchantId: string;
    description: string;
    amountCents: number;
    state: string;
    paypalCaptureId: string | null;
    deliveryPhotoUrl: string | null;
    deliveredAt: string | null;
    verifierResult: null | { pass: boolean; confidence: number; reason: string; source: string };
  }>;
  payouts: Array<{ allocationId: string; netCents: number; feeCents: number; status: string; payoutBatchId: string | null; failureReason: string | null }>;
}
export interface FeedEvent {
  seq: number;
  orderId: string | null;
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads are heterogeneous JSON, rendered defensively
  payload: Record<string, any>;
  createdAt: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PayPal JS SDK ships no types
    paypal?: any;
  }
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
