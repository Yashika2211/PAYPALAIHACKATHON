# TODO

## Done
- [x] M0: plan, data model, state machine, PayPal endpoint map (`docs/PLAN.md`)
- [x] Sandbox verified: OAuth, single-unit AUTHORIZE, Payouts (multi-unit AUTHORIZE unsupported, see PLAN §7)
- [x] AI provider: Gemini free tier (3.8 Flash / 3.5 Flash Lite) with deterministic fallback when no key
- [x] DB schema + migrations + seed (5 merchants incl. rogue)
- [x] Typed PayPal client: token cache, PayPal-Request-Id, retry/backoff, redacted call log
- [x] Mandate Firewall + injection scanner + HMAC mandates + state machine + offer protocol + bundle solver (100% covered)
- [x] Buyer planner, merchant agents (floors enforced in code, no price increases), rogue merchant
- [x] Parallel negotiation engine + bundle + AI rationale (verified live: rogue quarantined, $712 vs $820 first quotes)
- [x] Settlement service: create order, authorize, per-merchant partial capture, payout (3% fee), void, webhook processing
- [x] Webhook endpoint with signature verification + idempotent storage; registered via cloudflared tunnel
- [x] M1 buyer flow UI (plain)

## In progress
- [ ] M1 sign-off: approve in PayPal sandbox popup → authorize → capture → payout → webhooks land

## Next
- [ ] M2: SSE Negotiation Theater (currently 700ms polling of the events table)
- [ ] M3: firewall decision feed polish, Gemini injection classifier as second opinion
- [ ] M4: vision catalog extraction, AG Grid catalog editor, guardrails, live agent
- [ ] M5: DeliveryVerifier, refund path, AG Grid ledger (live), PayPal debug panel
- [ ] M6: design pass (themes, motion, mobile, empty/error states)
- [ ] M7: Render Blueprint, README, DEVPOST.md, DEMO_SCRIPT.md, CI, Playwright e2e
- [ ] M8 (stretch): Vault auto-approve, Invoicing, MCP server

## Cut / changed
- Multi purchase-unit AUTHORIZE → one purchase unit with itemized merchants + per-merchant partial captures (PayPal limitation)
- Anthropic → Gemini (no API credits); provider is swappable via LLM_PROVIDER
