# TODO

## Done
- [x] M0: plan, data model, state machine, PayPal endpoint map (`docs/PLAN.md`)

## In progress
- [x] PayPal sandbox creds verified (OAuth, single-PU AUTHORIZE, Payouts)
- [ ] Waiting on: Anthropic API key, sandbox buyer + merchant emails

## Next
- [ ] M1: thin slice end to end (seed → request → single negotiation → mandate → authorize → capture → payout → webhook)
- [ ] M2: multi-merchant, SSE Negotiation Theater, bundle solver, multi-PU order, partial captures
- [ ] M3: Mandate Firewall (100% coverage), rogue merchant, injection detection, decision feed
- [ ] M4: vision catalog extraction, AG Grid catalog editor, guardrails, live agent
- [ ] M5: DeliveryVerifier, void/refund, AG Grid ledger (live), PayPal debug panel
- [ ] M6: design pass (themes, motion, mobile, empty/error states)
- [ ] M7: Render Blueprint, webhook registration, README, DEVPOST.md, DEMO_SCRIPT.md, CI
- [ ] M8 (stretch): Vault auto-approve, Invoicing, MCP server

## Cut
- (none yet)
