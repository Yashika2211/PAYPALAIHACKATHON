"use client";

import { useEffect } from "react";
import { Button, ButtonLink, Label } from "@/components/ui";

/** Friendly error screen: no stack traces, a reference code, and a way forward. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-20">
      <Label className="text-bad">Something went wrong</Label>
      <h1 className="mt-3 font-serif text-4xl leading-tight">That didn&apos;t go through.</h1>
      <p className="mt-3 text-muted">
        No money moved because of this error: PayPal holds and captures only change when PayPal confirms them. Try again, or start over.
      </p>
      {error.digest && <p className="figures mt-4 text-xs text-faint">Reference {error.digest}</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Back to Haggle
        </ButtonLink>
      </div>
    </main>
  );
}
