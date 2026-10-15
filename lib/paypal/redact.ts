const SECRET_KEYS = new Set([
  "access_token",
  "authorization",
  "client_secret",
  "password",
  "nonce",
  "transmission_sig",
  "cert_url",
]);
const EMAIL_KEYS = new Set(["email_address", "email", "receiver", "payer_email"]);

function maskEmail(value: string): string {
  const [user, domain] = value.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

/** Deep-copies a JSON value with secrets removed and emails masked, for logs and the debug panel. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const k = key.toLowerCase();
      if (SECRET_KEYS.has(k)) out[key] = "[redacted]";
      else if (EMAIL_KEYS.has(k) && typeof v === "string") out[key] = maskEmail(v);
      else out[key] = redact(v);
    }
    return out;
  }
  return value;
}
