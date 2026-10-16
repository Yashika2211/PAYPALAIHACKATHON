"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button, Label, cx } from "@/components/ui";

const EXAMPLES = [
  "Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800.",
  "Vegan desserts and table flowers for a 60-person team dinner on Thursday, budget $900.",
  "Lunch and 25 name badges for a board meeting tomorrow, all vegetarian, under $500.",
  "25 printed name badges for Thursday's board meeting, under $150.",
];

// Minimal typing for the browser Web Speech API (not in TS's DOM lib).
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function speechCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const noop = () => () => {};

/** Dictation for the request box, where the browser supports it. */
function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => speechCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => onText(Array.from(e.results, (res) => res[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }
  return { supported, listening, toggle };
}

export default function NewRequest() {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dictation = useDictation(setText);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.push(`/buy/${data.rfqId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-14">
      <Label>Step 1 of 5 · Request</Label>
      <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">What do you need?</h1>
      <p className="mt-3 text-muted">Say it the way you&apos;d tell a colleague. Your buyer agent turns it into line items and finds the merchants.</p>

      <form onSubmit={submit} className="mt-8">
        <div className="rounded-lg border border-line-strong bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            aria-label="Your request"
            className="block w-full resize-none rounded-t-lg bg-transparent p-4 text-lg outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span className="flex items-center gap-3">
              {dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-pressed={dictation.listening}
                  className={cx(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition",
                    dictation.listening ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink",
                  )}
                >
                  <span className={cx("h-2 w-2 rounded-full", dictation.listening ? "pulse-dot bg-accent" : "bg-line-strong")} />
                  {dictation.listening ? "Listening… tap to stop" : "Speak it"}
                </button>
              )}
              <span className="figures text-xs text-faint">{text.length} chars</span>
            </span>
            <Button disabled={busy || text.trim().length < 8}>{busy ? "Planning…" : "Plan my request →"}</Button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      </form>

      <Label className="mt-10">Try one</Label>
      <ul className="mt-3 flex flex-col gap-2">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              onClick={() => setText(ex)}
              className={cx(
                "w-full rounded-md border px-4 py-3 text-left text-sm transition",
                ex === text ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong hover:bg-surface",
              )}
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
