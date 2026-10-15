import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { redact } from "./redact";

const BASE_URL =
  process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** OAuth2 client-credentials token, cached until 60s before expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !body.access_token) {
    throw new PayPalError("PayPal OAuth failed", res.status, redact(body));
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 300) - 60) * 1000,
  };
  return cachedToken.value;
}

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /** Stable key for this logical operation; reused across retries so PayPal dedupes. */
  requestId?: string;
  /** Haggle order id, for the debug panel. */
  orderId?: string;
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Typed PayPal REST call with idempotency (PayPal-Request-Id on every mutation),
 * retry with exponential backoff + jitter on 429/5xx, and a redacted call log.
 */
export async function paypalRequest<T>(req: PayPalRequest): Promise<T> {
  const requestId = req.method === "GET" ? undefined : (req.requestId ?? randomUUID());

  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;

    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch(`${BASE_URL}${req.path}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      status = res.status;
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
      if (status === 401) cachedToken = null;
    } catch (err) {
      body = { network_error: String(err) };
    }

    await logCall(req, requestId, status, body, Date.now() - started);

    if (status >= 200 && status < 300) return body as T;

    const retryable = status === 0 || status === 401 || status === 429 || status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      const b = body as { name?: string; message?: string; debug_id?: string } | null;
      throw new PayPalError(
        `${req.method} ${req.path} failed: ${b?.name ?? status} ${b?.message ?? ""}`.trim(),
        status,
        redact(body),
        b?.debug_id,
      );
    }
    await sleep(2 ** attempt * 250 + Math.random() * 250);
  }
}

async function logCall(
  req: PayPalRequest,
  requestId: string | undefined,
  status: number,
  response: unknown,
  durationMs: number,
) {
  try {
    await db.insert(schema.paypalApiCalls).values({
      orderId: req.orderId,
      method: req.method,
      path: req.path,
      requestId,
      status,
      request: (redact(req.body ?? null) ?? null) as object | null,
      response: (redact(response) ?? null) as object | null,
      durationMs,
    });
  } catch (err) {
    // Logging must never break a payment flow.
    console.error("paypal call log failed", err instanceof Error ? err.message : err);
  }
}
