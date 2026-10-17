# Changelog

All work happened on `main`. Each entry was verified against the real PayPal sandbox.

## 2026-10-17: Final polish
- App icon, social preview image and page titles.
- Branded error, global-error and 404 pages (no stack traces).
- Buyer flow split into focused components (`components/buy/*`).
- Accessibility: skip link, landmarks, live regions for the firewall feed and PayPal timeline, and step state.
- Repo: Node version file, `pnpm verify`, README badges, GitHub topics.

## 2026-10-16: Agentic payments and hardening
- **PayPal Vault:** save a method for the agent; it auto-pays at or under the mandate threshold, and the firewall makes it ask above.
- **Net terms:** a billing agent drives the **PayPal Agent Toolkit** (`create_invoice`, `send_invoice`) through firewall-wrapped tools; Invoicing v2 payment terms, payment recording and cancellation.
- **MCP server** (`/api/mcp`): external agents can discover merchants, request quotes, negotiate and pay under the same mandate rules.
- Payout failures are recorded, shown and auto-retried; missed payout webhooks are reconciled with PayPal; unsent payouts are re-driven.
- Per-client rate limits on endpoints that spend AI quota; card data redacted from PayPal call logs.
- Self-healing webhook tunnel (`pnpm tunnel`), sandbox balance top-up, demo-mode recording with replayed real AI answers.
- Voice dictation, folded negotiation transcripts, landing sections for the PayPal features and MCP.

## 2026-10-15: Marketplace
- **M0** plan, data model and order state machine; sandbox probes (multi-unit AUTHORIZE unsupported → one itemized purchase unit).
- **M1** end-to-end slice: request → mandate → negotiation → PayPal authorize → capture → payout → signed webhooks.
- **M2** parallel negotiations, a deterministic bundle solver, and a Server-Sent Events Negotiation Theater.
- **M3** Mandate Firewall (pure, 100% covered), HMAC-signed mandates, injection scanner, and a rogue merchant that is quarantined live.
- **M4** merchant onboarding: Gemini vision catalog extraction, AG Grid editor, guardrails with private floors, agent personality.
- **M5** AI delivery verification (catches wrong goods and short deliveries), void, refund, payout retry, PayPal API debug panel, live AG Grid ledger.
- **M6** "market ledger" design system, light/dark, mobile.
- **M7** Render Blueprint, CI, Playwright and sandbox end-to-end suites, README, Devpost draft, demo script.
