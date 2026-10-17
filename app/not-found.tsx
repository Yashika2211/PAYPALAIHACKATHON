import { ButtonLink, Label } from "@/components/ui";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-20">
      <Label>404</Label>
      <h1 className="mt-3 font-serif text-4xl leading-tight">No haggling here.</h1>
      <p className="mt-3 text-muted">This page doesn&apos;t exist. The request or order may have been reset with the demo data.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/buy/new">Start a request</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Home
        </ButtonLink>
      </div>
    </main>
  );
}
