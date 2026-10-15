import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Haggle</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        Every small business gets an AI salesperson. Every buyer gets an AI negotiator. PayPal makes the handshake real.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/buy/new" className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700">
          I need something
        </Link>
        <span className="rounded-lg border border-neutral-300 px-5 py-3 text-neutral-500 dark:border-neutral-700">
          I&apos;m a merchant (coming in M4)
        </span>
      </div>
    </main>
  );
}
