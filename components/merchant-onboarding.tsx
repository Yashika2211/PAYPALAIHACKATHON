"use client";

import type { CellValueChangedEvent, ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact, haggleGridTheme } from "@/components/grid";
import { Button, ButtonLink, Card, Field, Pill, cx, inputClass } from "@/components/ui";
import { fileFromUrl, prepareUpload } from "@/lib/image";
import { formatUsd } from "@/lib/money";

interface Row {
  id: number;
  name: string;
  unit: string;
  priceCents: number;
  dietaryTags: string[];
  confidence: number | null;
}

type Personality = "friendly" | "firm" | "upsell";
const PERSONALITIES: Array<{ id: Personality; label: string; line: string }> = [
  { id: "friendly", label: "Friendly", line: "Finds a win-win fast and gives a fair discount to close." },
  { id: "firm", label: "Firm", line: "Holds price on quality. Concedes slowly, and only a little." },
  { id: "upsell", label: "Upsell-happy", line: "Discounts reluctantly but suggests extras that grow the order." },
];
const CATEGORIES = ["catering", "bakery", "printing", "flowers"];

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function ConfidenceCell({ value }: ICellRendererParams<Row, number | null>) {
  if (value == null) return <Pill>manual</Pill>;
  const pct = Math.round(value * 100);
  return <Pill tone={value >= 0.85 ? "good" : value >= 0.6 ? "warn" : "bad"}>{pct}%</Pill>;
}

export function MerchantOnboarding({ defaultPayoutEmail }: { defaultPayoutEmail: string }) {
  const [phase, setPhase] = useState<"upload" | "edit" | "live">("upload");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [drag, setDrag] = useState(false);
  const [source, setSource] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("catering");
  const [tagline, setTagline] = useState("");
  const [personality, setPersonality] = useState<Personality>("friendly");
  const [maxDiscount, setMaxDiscount] = useState(15);
  const [leadTime, setLeadTime] = useState(24);
  const [capacity, setCapacity] = useState(120);
  const [payoutEmail, setPayoutEmail] = useState(defaultPayoutEmail);
  const [live, setLive] = useState<{ merchantId: string; greeting: string } | null>(null);
  const nextId = useRef(1000);

  async function extract(input: { file?: File; text?: string }) {
    setBusy("extract");
    setError("");
    try {
      let file: { base64: string; mediaType: string } | undefined;
      if (input.file) {
        const prepared = await prepareUpload(input.file);
        file = { base64: prepared.base64, mediaType: prepared.mediaType };
        if (input.file.type.startsWith("image/")) setPreview(URL.createObjectURL(input.file));
      }
      const data = await post<{ businessName: string | null; category: string; items: Omit<Row, "id">[]; source: string; model: string | null }>(
        "/api/catalog/extract",
        { file, text: input.text },
      );
      setRows(data.items.map((it, i) => ({ ...it, id: i + 1 })));
      if (data.businessName) setName(data.businessName.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()));
      setCategory(data.category || "catering");
      setSource(data.source === "llm" ? `Read by ${data.model}` : "Parsed without AI");
      setPhase("edit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) extract({ file: f });
  };

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "name", headerName: "Item", editable: true, flex: 2, minWidth: 180 },
      { field: "unit", headerName: "Unit", editable: true, width: 130 },
      {
        field: "priceCents",
        headerName: "List price",
        editable: true,
        width: 120,
        type: "rightAligned",
        cellClass: "figures",
        valueFormatter: (p) => formatUsd(p.value ?? 0),
        valueParser: (p) => Math.max(1, Math.round(Number(String(p.newValue).replace(/[$,]/g, "")) * 100) || p.oldValue),
      },
      {
        colId: "floor",
        headerName: "Private floor",
        headerTooltip: "Lowest price the engine will accept. Never shown to the AI agent.",
        width: 130,
        type: "rightAligned",
        cellClass: "figures text-muted",
        valueGetter: (p) => (p.data ? Math.ceil(p.data.priceCents * (1 - maxDiscount / 100)) : 0),
        valueFormatter: (p) => formatUsd(p.value ?? 0),
      },
      {
        field: "dietaryTags",
        headerName: "Dietary",
        editable: true,
        width: 170,
        valueFormatter: (p) => (p.value as string[] | undefined)?.join(", ") ?? "",
        valueParser: (p) =>
          String(p.newValue ?? "")
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
      },
      { field: "confidence", headerName: "AI read", width: 100, cellRenderer: ConfidenceCell, sort: "asc" },
      {
        colId: "remove",
        headerName: "",
        width: 64,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Row>) => (
          <button
            aria-label={`Remove ${p.data?.name}`}
            className="text-faint transition hover:text-bad"
            onClick={() => setRows((rs) => rs.filter((r) => r.id !== p.data?.id))}
          >
            ✕
          </button>
        ),
      },
    ],
    [maxDiscount],
  );

  const onCellValueChanged = useCallback((e: CellValueChangedEvent<Row>) => {
    // A merchant-reviewed row is no longer an AI guess.
    setRows((rs) => rs.map((r) => (r.id === e.data.id ? { ...e.data, confidence: null } : r)));
  }, []);

  async function goLive() {
    setBusy("live");
    setError("");
    try {
      const data = await post<{ merchantId: string; greeting: string }>("/api/merchants", {
        name,
        category,
        tagline,
        personality,
        maxDiscountPct: maxDiscount,
        leadTimeHours: leadTime,
        dailyCapacity: capacity,
        payoutEmail,
        items: rows.map(({ name, unit, priceCents, dietaryTags, confidence }) => ({ name, unit, priceCents, dietaryTags, confidence })),
      });
      setLive(data);
      setPhase("live");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const lowConfidence = rows.filter((r) => r.confidence != null && r.confidence < 0.85).length;

  if (phase === "live" && live) {
    const p = PERSONALITIES.find((x) => x.id === personality)!;
    return (
      <Card className="rise mx-auto max-w-2xl overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line p-6">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink font-serif text-2xl text-paper">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-2xl">{name}</h2>
              <Pill tone="good">agent live</Pill>
            </div>
            <p className="text-sm text-muted">
              {category} · {p.label.toLowerCase()} agent · {rows.length} items · up to {maxDiscount}% off list
            </p>
          </div>
        </div>
        <blockquote className="p-6 font-serif text-xl leading-snug italic">&ldquo;{live.greeting}&rdquo;</blockquote>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/50 p-5">
          <p className="text-sm text-muted">Your agent is now negotiating with buyers&apos; agents. Payouts go to your PayPal.</p>
          <ButtonLink href="/buy/new">Try buying from it →</ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {phase === "upload" && (
        <Card className="rise overflow-hidden">
          {!pasteMode ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cx(
                "flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-16 text-center transition",
                drag ? "bg-accent-soft/50" : "hover:bg-sunken/50",
              )}
            >
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && extract({ file: e.target.files[0] })}
              />
              <span className="grid h-12 w-12 place-items-center rounded-full border border-line-strong font-serif text-2xl">↑</span>
              <span className="text-lg font-medium">{busy === "extract" ? "Reading your menu…" : "Drop a photo or PDF of your menu or price list"}</span>
              <span className="text-sm text-muted">or click to choose a file. Paper menus, flyers and screenshots all work.</span>
            </label>
          ) : (
            <div className="p-5">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={8}
                placeholder={"Veggie wrap ...... $9.50 each\nChicken box ...... $12.00 per person"}
                className={cx(inputClass, "figures resize-y")}
              />
              <Button className="mt-3" onClick={() => extract({ text: pasted })} disabled={busy === "extract" || pasted.trim().length < 5}>
                {busy === "extract" ? "Reading…" : "Extract catalog"}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
            <button className="text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setPasteMode((m) => !m)}>
              {pasteMode ? "Upload a file instead" : "Paste text instead"}
            </button>
            <Button
              variant="secondary"
              disabled={busy === "extract"}
              onClick={async () => extract({ file: await fileFromUrl("/demo/menu.jpg", "menu.jpg") })}
            >
              Use sample paper menu
            </Button>
          </div>
          {busy === "extract" && <div className="h-0.5 w-full animate-pulse bg-accent" />}
        </Card>
      )}

      {phase === "edit" && (
        <>
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="Uploaded menu" className="rise w-full rounded-lg border border-line object-cover lg:sticky lg:top-4" />
            ) : (
              <div className="hidden lg:block" />
            )}
            <Card className="rise min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Catalog</h2>
                  <span className="figures text-xs text-muted">{rows.length} items</span>
                  {lowConfidence > 0 && <Pill tone="warn">{lowConfidence} to check</Pill>}
                </div>
                <span className="figures text-xs text-muted">{source}</span>
              </div>
              <div style={{ height: Math.min(520, 56 + rows.length * 44 + 20) }}>
                <AgGridReact<Row>
                  theme={haggleGridTheme}
                  rowData={rows}
                  columnDefs={columns}
                  getRowId={(p) => String(p.data.id)}
                  onCellValueChanged={onCellValueChanged}
                  singleClickEdit
                  stopEditingWhenCellsLoseFocus
                  domLayout="normal"
                />
              </div>
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
                <button
                  className="text-muted hover:text-ink"
                  onClick={() => setRows((rs) => [...rs, { id: nextId.current++, name: "New item", unit: "each", priceCents: 1000, dietaryTags: [], confidence: null }])}
                >
                  + Add item
                </button>
                <span className="text-xs text-muted">Click any cell to edit. Floors update with your discount guardrail.</span>
              </div>
            </Card>
          </div>

          <Card className="rise">
            <div className="border-b border-line p-5">
              <h2 className="font-serif text-2xl">Your agent&apos;s guardrails</h2>
              <p className="mt-1 text-sm text-muted">Enforced in code on every offer. The AI never sees your floors and can&apos;t talk its way past them.</p>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-3">
              <Field label="Business name">
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Category" hint="Buyers' agents find you by category">
                <input list="haggle-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
                <datalist id="haggle-categories">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="One-line pitch">
                <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Home-style lunches, delivered" className={inputClass} />
              </Field>
              <Field label={`Max discount: ${maxDiscount}%`} hint="Your private floor is list price minus this">
                <input type="range" min={0} max={40} value={maxDiscount} onChange={(e) => setMaxDiscount(Number(e.target.value))} className="accent-[var(--accent)]" />
              </Field>
              <Field label={`Lead time: ${leadTime}h`} hint="Minimum notice before delivery">
                <input type="range" min={4} max={96} step={4} value={leadTime} onChange={(e) => setLeadTime(Number(e.target.value))} className="accent-[var(--accent)]" />
              </Field>
              <Field label={`Daily capacity: ${capacity}`} hint="Most units you can deliver per day">
                <input type="range" min={10} max={500} step={10} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className="accent-[var(--accent)]" />
              </Field>
            </div>
            <div className="border-t border-line p-5">
              <p className="text-sm font-medium">Agent personality</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {PERSONALITIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPersonality(p.id)}
                    aria-pressed={personality === p.id}
                    className={cx("rounded-md border p-3 text-left transition", personality === p.id ? "border-ink bg-ink text-paper" : "border-line hover:border-line-strong")}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className={cx("mt-1 block text-xs", personality === p.id ? "opacity-70" : "text-muted")}>{p.line}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 border-t border-line p-5 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Get paid at (PayPal email)" hint="Payouts land here after each verified delivery, minus Haggle's 3% fee">
                <input type="email" value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} className={inputClass} />
              </Field>
              <Button onClick={goLive} disabled={busy === "live" || !name.trim() || rows.length === 0} className="px-6 py-3">
                {busy === "live" ? "Going live…" : "Go live →"}
              </Button>
            </div>
          </Card>
        </>
      )}

      {error && <p className="rounded-md border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
      {phase === "upload" && (
        <p className="text-center text-sm text-muted">
          Already set up? <Link href="/buy/new" className="text-ink underline underline-offset-4">See it from the buyer side</Link>
        </p>
      )}
    </div>
  );
}
