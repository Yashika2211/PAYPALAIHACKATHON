"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLE =
  "Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800.";

export default function NewRequest() {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: text }) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setBusy(false);
      return;
    }
    router.push(`/buy/${data.rfqId}`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold">What do you need?</h1>
      <p className="mt-1 text-neutral-500">Describe it like you would to a colleague. Your buyer agent does the rest.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="rounded-lg border border-neutral-300 bg-transparent p-3 dark:border-neutral-700"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="self-start rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white disabled:opacity-50">
          {busy ? "Planning…" : "Plan my request"}
        </button>
      </form>
    </main>
  );
}
