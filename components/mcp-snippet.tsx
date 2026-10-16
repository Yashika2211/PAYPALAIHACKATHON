"use client";

import { useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/** The one-line command to connect an MCP client, with this deployment's real URL. */
export function McpSnippet() {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "https://your-haggle-host");
  const command = `claude mcp add --transport http haggle ${origin}/api/mcp`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-line-strong bg-ink px-3 py-2.5 text-paper">
      <code className="figures min-w-0 flex-1 overflow-x-auto text-[13px] whitespace-nowrap">{command}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked: the command is selectable */
          }
        }}
        className="figures shrink-0 rounded border border-paper/20 px-2 py-1 text-[11px] uppercase tracking-wider text-paper/70 hover:text-paper"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
