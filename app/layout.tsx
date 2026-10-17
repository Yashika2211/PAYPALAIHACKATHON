import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeToggle, themeScript } from "@/components/theme-toggle";
import { publicOrigin } from "@/lib/origin";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Haggle", template: "%s · Haggle" },
  description: "Every small business gets an AI salesperson. Every buyer gets an AI negotiator. PayPal makes the handshake real.",
  metadataBase: new URL(publicOrigin()),
  openGraph: { title: "Haggle", description: "Agentic commerce you can trust, on PayPal.", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#11100d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
            <Link href="/" className="flex items-baseline gap-1.5">
              <span className="font-serif text-2xl leading-none">Haggle</span>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1 text-sm">
              <Link href="/buy/new" className="rounded-md px-3 py-1.5 text-muted transition hover:bg-sunken hover:text-ink">
                Buy
              </Link>
              <Link href="/sell" className="rounded-md px-3 py-1.5 text-muted transition hover:bg-sunken hover:text-ink">
                Sell
              </Link>
              <Link href="/ledger" className="rounded-md px-3 py-1.5 text-muted transition hover:bg-sunken hover:text-ink">
                Ledger
              </Link>
              <span className="figures ml-2 hidden rounded border border-line px-2 py-1 text-[11px] uppercase tracking-wider text-muted md:inline">
                PayPal sandbox
              </span>
              <span className="ml-2">
                <ThemeToggle />
              </span>
            </nav>
          </div>
        </header>
        <div id="content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </div>
        <footer className="mt-auto border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted">
            <span>Haggle. Agentic commerce you can trust, on PayPal.</span>
            <span className="figures">Sandbox only. No real money moves.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
