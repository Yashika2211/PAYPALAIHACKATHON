const SECRET_KEYS = new Set([
  "access_token",
  "authorization",
  "client_secret",
  "password",
  "nonce",
  "transmission_sig",
  "cert_url",
  "security_code",
  "cvv",
  "cvv2",
]);
const EMAIL_KEYS = new Set(["email_address", "email", "receiver", "payer_email"]);
/** Card data: never logged in full (PCI), even in the sandbox. */
const CARD_NUMBER_KEYS = new Set(["number", "card_number"]);
const PARTIAL_KEYS = new Set(["vault_id", "expiry"]);

function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

const maskCard = (value: string) => (value.length >= 8 ? `•••• ${value.slice(-4)}` : "[redacted]");
const maskPartial = (value: string) => (value.length > 6 ? `${value.slice(0, 3)}…${value.slice(-2)}` : "[redacted]");

/** Deep-copies a JSON value with secrets and card data removed and emails masked, for logs and the debug panel. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const k = key.toLowerCase();
      if (SECRET_KEYS.has(k)) out[key] = "[redacted]";
      else if (typeof v === "string" && EMAIL_KEYS.has(k)) out[key] = maskEmail(v);
      else if (typeof v === "string" && CARD_NUMBER_KEYS.has(k)) out[key] = maskCard(v);
      else if (typeof v === "string" && PARTIAL_KEYS.has(k)) out[key] = maskPartial(v);
      else out[key] = redact(v);
    }
    return out;
  }
  return value;
}
