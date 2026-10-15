"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid theme bound to Haggle's CSS tokens, so it follows light/dark automatically. */
export const haggleGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  chromeBackgroundColor: "var(--paper)",
  headerTextColor: "var(--muted)",
  borderColor: "var(--line)",
  accentColor: "var(--accent)",
  oddRowBackgroundColor: "var(--surface)",
  selectedRowBackgroundColor: "var(--accent-soft)",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  cellFontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  headerFontWeight: 500,
  fontSize: 13,
  spacing: 7,
  wrapperBorderRadius: 8,
  browserColorScheme: "inherit",
});

export { AgGridReact } from "ag-grid-react";
