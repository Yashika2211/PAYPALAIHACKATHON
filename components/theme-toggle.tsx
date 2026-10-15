"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, current, () => null);

  function toggle() {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("haggle-theme", next);
    } catch {
      /* private mode: theme just won't persist */
    }
    listeners.forEach((l) => l());
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle color theme"
      className="figures rounded-md border border-line px-2 py-1 text-[11px] uppercase tracking-wider text-muted transition hover:text-ink"
    >
      {theme === null ? "Theme" : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

/** Inline script that applies the saved theme before first paint. */
export const themeScript = `try{var t=localStorage.getItem("haggle-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
