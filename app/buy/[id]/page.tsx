import { Suspense } from "react";
import { BuyFlow } from "@/components/buy-flow";

export default function BuyPage({ params }: PageProps<"/buy/[id]">) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 text-muted">Loading your request…</main>}>
      <Resolved params={params} />
    </Suspense>
  );
}

async function Resolved({ params }: { params: PageProps<"/buy/[id]">["params"] }) {
  const { id } = await params;
  return <BuyFlow id={id} />;
}
