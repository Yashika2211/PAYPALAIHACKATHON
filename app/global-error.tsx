"use client";

/** Last-resort error page. Renders its own document, so styles are inline. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f1ea", color: "#17150f", fontFamily: "system-ui, sans-serif" }}>
        <title>Haggle · Something went wrong</title>
        <main style={{ maxWidth: 520, padding: 24 }}>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#c0301d" }}>Something went wrong</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 36, margin: "12px 0" }}>Haggle hit an unexpected error.</h1>
          <p style={{ color: "#6b665a" }}>No money moved because of this. Please try again.</p>
          {error.digest && <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#9a9486" }}>Reference {error.digest}</p>}
          <button onClick={() => retry()} style={{ marginTop: 16, padding: "10px 16px", border: 0, borderRadius: 6, background: "#e4501b", color: "#fff", font: "inherit", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
