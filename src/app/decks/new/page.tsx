import Link from "next/link";
import { redirect } from "next/navigation";
import { createDeckAction } from "@/features/decks/actions";
import { auth } from "@/lib/auth";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Novo baralho</h1>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← voltar
        </Link>
      </div>

      <div aria-live="polite">
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>

      <form action={createDeckAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Nome
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={120}
            autoFocus
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">
            Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            maxLength={2000}
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Criar baralho
        </button>
      </form>
    </main>
  );
}
