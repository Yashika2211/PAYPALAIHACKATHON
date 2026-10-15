import { MerchantOnboarding } from "@/components/merchant-onboarding";
import { Label } from "@/components/ui";

export default function SellPage() {
  // First sandbox merchant account as a convenient default; merchants overwrite it with their own.
  const defaultPayoutEmail = (process.env.SANDBOX_MERCHANT_EMAILS ?? "").split(",")[0]?.trim() ?? "";
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
      <Label>For merchants · agent-ready in a minute</Label>
      <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-tight sm:text-5xl">Show us your menu. We&apos;ll give you a salesperson that never sleeps.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Haggle reads your menu, builds your catalog and puts an AI agent to work negotiating with buyers&apos; agents, inside limits you set.
      </p>
      <div className="mt-10">
        <MerchantOnboarding defaultPayoutEmail={defaultPayoutEmail} />
      </div>
    </main>
  );
}
