import { PayPalError } from "@/lib/paypal/client";

/** Wraps a route handler: JSON errors with a safe message, never a stack trace. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof PayPalError) {
      console.error("[paypal]", err.message, err.debugId ?? "");
      return Response.json({ error: err.message, debugId: err.debugId }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error("[api]", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
