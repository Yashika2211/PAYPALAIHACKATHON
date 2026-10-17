import { ImageResponse } from "next/og";

export const alt = "Haggle: agentic commerce you can trust, on PayPal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card in the same paper/ink/vermilion identity as the app. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f1ea", padding: 72, fontFamily: "serif" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 64, color: "#17150f" }}>Haggle</span>
          <span style={{ width: 16, height: 16, borderRadius: 8, background: "#e4501b" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 66, lineHeight: 1.05, color: "#17150f", maxWidth: 1000 }}>Every small business gets an AI salesperson. Every buyer gets an AI negotiator.</div>
          <div style={{ fontSize: 34, color: "#e4501b" }}>PayPal makes the handshake real.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#6b665a", fontFamily: "monospace" }}>
          <span>MANDATE FIREWALL · PAYPAL ESCROW · AI AGENTS</span>
          <span>▼ held, not charged</span>
        </div>
      </div>
    ),
    size,
  );
}
