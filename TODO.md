# TODO

## Done
- [x] M0: plan, data model, state machine, PayPal endpoint map (`docs/PLAN.md`)
- [x] M1: seeded merchants → request → negotiation → mandate → PayPal authorize → capture → payout → webhooks (verified in sandbox)
- [x] M2: parallel negotiations, bundle solver, SSE Negotiation Theater, per-merchant partial captures
- [x] M3: Mandate Firewall (100% coverage), HMAC mandates, rogue merchant, injection detection + quarantine, decision feed
- [x] M4: vision catalog extraction, AG Grid catalog editor, guardrails (private floors), personality, live agent greeting
- [x] M5: DeliveryVerifier (vision, catches wrong/short deliveries) with human override, void, refund, payout retry, PayPal API debug panel, live AG Grid ledger
- [x] M6: "market ledger" design: light/dark, motion, mobile, empty/error states
- [x] M7: render.yaml Blueprint (web + cron + Postgres), CI, Playwright e2e, sandbox e2e script, README, DEVPOST.md, DEMO_SCRIPT.md
- [x] Resilience: model × key chain, quota cooldown, cached real answers, deterministic fallbacks

## Needs the account owner
- [ ] Deploy on Render (New → Blueprint), then `pnpm webhook:register https://<render-url>` and set PAYPAL_WEBHOOK_ID
- [ ] Record the demo video (docs/DEMO_SCRIPT.md), upload public on YouTube
- [ ] Devpost: paste docs/DEVPOST.md, add sandbox buyer password in the private testing notes
- [ ] Optional: add 1–2 more free Gemini keys (separate projects) comma-separated for more quota

## Stretch (M8): done
- [x] Vault: save a method for the agent; agent auto-pays at/under the mandate threshold, asks above it (`pnpm e2e:vault`, verified in sandbox)
- [x] Invoicing v2 net terms via the PayPal Agent Toolkit, firewall-wrapped tools (`pnpm e2e:invoice`, verified in sandbox)
- [x] MCP server for external AI agents under mandate rules (`pnpm mcp:smoke`)
- [x] Voice dictation on the request box; folded transcripts; mobile pass
- [ ] Re-run the billing agent's LLM path once the Gemini quota resets (fallback path verified)

## Changed from the original plan
- Multi purchase-unit AUTHORIZE → one purchase unit, itemized per merchant, per-merchant partial captures (PayPal limitation)
- Anthropic → Gemini free tier (no API credits); provider stays swappable via LLM_PROVIDER
- Separate worker → negotiations run in-process via Next.js `after()`; the events table keeps a worker optional
- AG Grid Enterprise features (row grouping, sparklines) → Community equivalents (sort-based grouping, SVG sparkline renderer)
