"use client";

import type { ColDef, GridApi, GridReadyEvent, ICellRendererParams, RowClassParams } from "ag-grid-community";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, haggleGridTheme } from "@/components/grid";
import { Button, Card, Label, Money, Pill, STATE_TONE, cx, inputClass } from "@/components/ui";
import { reduceEvent, totals, type LedgerEvent, type LedgerRow, type LedgerType } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";

const TYPES: LedgerType[] = ["Quote", "Firewall", "Bundle", "Authorization", "Capture", "Payout", "Fee", "Void", "Refund", "Delivery"];
const STATUS_TONE: Record<string, "good" | "bad" | "warn" | "neutral" | "accent"> = {
  ...STATE_TONE,
  allow: "good",
  deny: "bad",
  needs_human: "warn",
  accepted: "good",
  blocked: "bad",
  negotiating: "accent",
  held: "warn",
  "partially captured": "warn",
  earned: "good",
  released: "neutral",
  verified: "good",
  "not verified": "warn",
  quoted: "accent",
};
const COLUMN_STATE_KEY = "haggle-ledger-columns-v1";

function StatusCell({ value }: ICellRendererParams<LedgerRow, string>) {
  if (!value) return null;
  return <Pill tone={STATUS_TONE[value] ?? "neutral"}>{value.replace(/_/g, " ")}</Pill>;
}

function TypeCell({ value }: ICellRendererParams<LedgerRow, string>) {
  return <span className="figures text-xs uppercase tracking-wider text-muted">{value}</span>;
}

/** Negotiation rounds as a tiny price-over-rounds line. Community-only: plain SVG. */
function SparklineCell({ data }: ICellRendererParams<LedgerRow>) {
  const r = data?.rounds;
  if (!r || r.length < 2) return r?.length === 1 ? <span className="figures text-xs text-faint">1 round</span> : null;
  const w = 84;
  const h = 22;
  const min = Math.min(...r);
  const max = Math.max(...r);
  const span = max - min || 1;
  const pts = r.map((v, i) => [(i / (r.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)]);
  const down = r[r.length - 1] < r[0];
  return (
    <span className="flex h-full items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`${r.length} rounds`}>
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={down ? "var(--good)" : "var(--muted)"} strokeWidth="1.6" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 2.4 : 1.4} fill={i === pts.length - 1 ? (down ? "var(--good)" : "var(--ink)") : "var(--faint)"} />
        ))}
      </svg>
      <span className="figures text-[11px] text-muted">{r.length}r</span>
    </span>
  );
}

export function Ledger() {
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  const rowsRef = useRef(new Map<string, LedgerRow>());
  // Ids the grid has actually received, so updates never target a row it doesn't know.
  const inGridRef = useRef(new Set<string>());
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState(totals([]));
  const [quick, setQuick] = useState("");
  const [types, setTypes] = useState<Set<LedgerType>>(new Set(TYPES));
  const [grouped, setGrouped] = useState(false);
  const [connected, setConnected] = useState(false);
  const typesRef = useRef(types);

  // Live feed: each SSE message is a batch of events → one grid transaction.
  useEffect(() => {
    const source = new EventSource("/api/ledger/stream?after=0");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (m) => {
      const batch = JSON.parse(m.data) as LedgerEvent[];
      const touched = new Map<string, LedgerRow>();
      for (const e of batch) {
        for (const row of reduceEvent(rowsRef.current, e)) {
          rowsRef.current.set(row.id, row);
          touched.set(row.id, row);
        }
      }
      const api = apiRef.current;
      if (api) {
        // Before the grid is ready, rows simply accumulate and are loaded in onGridReady.
        const rows = [...touched.values()];
        const add = rows.filter((r) => !inGridRef.current.has(r.id));
        add.forEach((r) => inGridRef.current.add(r.id));
        api.applyTransactionAsync({ add, update: rows.filter((r) => !add.includes(r)), addIndex: 0 });
      }
      setCount(rowsRef.current.size);
      setStats(totals(rowsRef.current.values()));
    };
    return () => source.close();
  }, []);

  const columns = useMemo<ColDef<LedgerRow>[]>(
    () => [
      {
        field: "ts",
        headerName: "Time",
        width: 110,
        sort: "desc",
        cellClass: "figures text-muted",
        valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""),
      },
      { field: "orderId", headerName: "Order", width: 104, cellClass: "figures text-muted", valueFormatter: (p) => (p.value ? String(p.value).slice(0, 8) : "–") },
      { field: "type", headerName: "Type", width: 128, cellRenderer: TypeCell },
      { field: "party", headerName: "Party", width: 190 },
      {
        field: "amountCents",
        headerName: "Amount",
        width: 120,
        type: "rightAligned",
        cellClass: "figures",
        enableCellChangeFlash: true,
        valueFormatter: (p) => (p.value == null ? "" : formatUsd(p.value)),
      },
      { field: "status", headerName: "Status", width: 150, cellRenderer: StatusCell, enableCellChangeFlash: true },
      { colId: "rounds", headerName: "Rounds", width: 130, sortable: false, cellRenderer: SparklineCell, valueGetter: (p) => p.data?.rounds?.join(",") ?? "" },
      { field: "detail", headerName: "Detail", flex: 1, minWidth: 240, tooltipField: "detail", cellClass: "text-muted" },
      { field: "rfqId", headerName: "Request", width: 104, hide: true, cellClass: "figures text-muted", valueFormatter: (p) => (p.value ? String(p.value).slice(0, 8) : "") },
    ],
    [],
  );

  const saveColumns = useCallback(() => {
    try {
      const api = apiRef.current;
      if (api) localStorage.setItem(COLUMN_STATE_KEY, JSON.stringify(api.getColumnState()));
    } catch {
      /* storage unavailable: column layout just won't persist */
    }
  }, []);

  const onGridReady = useCallback((e: GridReadyEvent<LedgerRow>) => {
    apiRef.current = e.api;
    const existing = [...rowsRef.current.values()];
    existing.forEach((r) => inGridRef.current.add(r.id));
    e.api.setGridOption("rowData", existing);
    try {
      const saved = localStorage.getItem(COLUMN_STATE_KEY);
      if (saved) e.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true });
    } catch {
      /* ignore corrupt saved state */
    }
  }, []);

  useEffect(() => {
    typesRef.current = types;
    apiRef.current?.onFilterChanged();
  }, [types]);

  // "Group by order" in Community: sort by order, then time, and draw a rule where each order starts.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.applyColumnState({
      state: grouped
        ? [
            { colId: "orderId", sort: "asc", sortIndex: 0 },
            { colId: "ts", sort: "asc", sortIndex: 1 },
          ]
        : [{ colId: "ts", sort: "desc", sortIndex: 0 }],
      defaultState: { sort: null },
    });
    api.redrawRows();
  }, [grouped]);

  const rowClassRules = useMemo(
    () => ({
      "haggle-group-start": (p: RowClassParams<LedgerRow>) => {
        if (!grouped || p.rowIndex === 0 || p.rowIndex == null) return false;
        const prev = p.api.getDisplayedRowAtIndex(p.rowIndex - 1);
        return prev?.data?.orderId !== p.data?.orderId;
      },
      "haggle-row-deny": (p: RowClassParams<LedgerRow>) => p.data?.status === "deny" || p.data?.status === "blocked",
    }),
    [grouped],
  );

  const pinned = useMemo<LedgerRow[]>(
    () => [
      {
        id: "totals",
        ts: "",
        type: "Fee",
        rfqId: null,
        orderId: null,
        party: "Totals",
        amountCents: stats.feesCents,
        status: "",
        detail: `captured ${formatUsd(stats.capturedCents)} · paid out ${formatUsd(stats.paidOutCents)} · released ${formatUsd(stats.releasedCents)} · refunded ${formatUsd(stats.refundedCents)}`,
      },
    ],
    [stats],
  );

  const toggleType = (t: LedgerType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next.size === 0 ? new Set(TYPES) : next;
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
        {[
          ["Held on PayPal", stats.heldCents],
          ["Captured", stats.capturedCents],
          ["Paid to merchants", stats.paidOutCents],
          ["Haggle fees", stats.feesCents],
          ["Never charged", stats.releasedCents],
        ].map(([label, cents]) => (
          <div key={label as string} className="bg-surface px-4 py-4">
            <Label>{label}</Label>
            <Money cents={cents as number} className="mt-1 block text-2xl" />
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter anything: merchant, capture id, status…" className={cx(inputClass, "max-w-xs py-1.5 text-sm")} aria-label="Quick filter" />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-[var(--accent)]" />
            Group by order
          </label>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cx("h-1.5 w-1.5 rounded-full", connected ? "pulse-dot bg-good" : "bg-faint")} />
            {connected ? "live" : "connecting"} · <span className="figures">{count}</span> rows · <span className="figures text-bad">{stats.blocked}</span> blocked
          </span>
          <Button variant="secondary" className="ml-auto px-3 py-1.5 text-xs" onClick={() => apiRef.current?.exportDataAsCsv({ fileName: `haggle-ledger-${new Date().toISOString().slice(0, 10)}.csv` })}>
            Export CSV
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              aria-pressed={types.has(t)}
              className={cx("figures rounded px-2 py-1 text-[11px] uppercase tracking-wider transition", types.has(t) ? "bg-ink text-paper" : "bg-sunken text-faint hover:text-muted")}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="h-[620px]">
          <AgGridReact<LedgerRow>
            theme={haggleGridTheme}
            columnDefs={columns}
            rowData={[]}
            getRowId={(p) => p.data.id}
            onGridReady={onGridReady}
            quickFilterText={quick}
            isExternalFilterPresent={() => typesRef.current.size !== TYPES.length}
            doesExternalFilterPass={(node) => (node.data ? typesRef.current.has(node.data.type) : true)}
            pinnedBottomRowData={pinned}
            rowClassRules={rowClassRules}
            onColumnMoved={saveColumns}
            onColumnResized={(e) => e.finished && saveColumns()}
            onSortChanged={saveColumns}
            onColumnVisible={saveColumns}
            animateRows
            tooltipShowDelay={400}
            overlayNoRowsTemplate='<span style="color:var(--muted)">No activity yet. Run a negotiation to fill the ledger.</span>'
          />
        </div>
      </Card>
      <p className="text-xs text-muted">
        Rows update in place through AG Grid transactions as negotiations, firewall decisions and PayPal webhooks arrive. Column layout is saved in this browser.{" "}
        <Link href="/buy/new" className="text-ink underline underline-offset-4">
          Start a request
        </Link>{" "}
        to watch it fill.
      </p>
    </div>
  );
}
