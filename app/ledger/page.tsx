import { Ledger } from "@/components/ledger";
import { Label } from "@/components/ui";

export default function LedgerPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
      <Label>Ledger · live</Label>
      <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">Every quote, decision and dollar.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Quotes with their negotiation rounds, every Mandate Firewall decision, and each PayPal authorization, capture, payout and fee, as they happen.
      </p>
      <div className="mt-8">
        <Ledger />
      </div>
    </main>
  );
}
