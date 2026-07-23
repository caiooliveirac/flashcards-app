import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { createDeckAction } from "@/features/decks/actions";
import { auth, signOut } from "@/lib/auth";

/**
 * Novo baralho — superfície de escrita do redesign "Editorial Cognition":
 * cada campo abre com régua de 2px + kicker; inputs raio zero sobre bg-surface.
 */

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.1em]";

const fieldClass = "border-t-2 border-divider pt-3";
const labelClass = `block ${KICKER} text-muted-foreground`;
const inputClass = "mt-2 min-h-11 w-full border-b border-border bg-surface px-3 py-2.5 text-base";

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
    <div className="min-h-dvh">
      <SiteHeader isAdmin={session.user.role === "admin"}>
        {session.user.role === "admin" ? (
          <Link href="/admin" className="hidden font-semibold hover:text-primary-text sm:inline">
            Admin
          </Link>
        ) : null}
        <span className="hidden text-muted-foreground sm:inline">
          {session.user.email ?? session.user.name}
        </span>
        <form
          className="hidden sm:block"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            data-ms-ripple="ink"
            className="min-h-11 border border-border px-4 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-xl px-5 py-10">
        <Link
          href="/"
          className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          ← Baralhos
        </Link>
        <p className={`mt-6 ${KICKER} text-muted-foreground`}>Novo baralho</p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight">
          Comece um novo assunto.
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Dê um nome ao baralho — a descrição ajuda a lembrar o recorte do assunto.
        </p>

        <div aria-live="polite">
          {error ? (
            <p
              role="alert"
              className="mt-6 border border-destructive px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <form action={createDeckAction} className="mt-10 space-y-8">
          <div className={fieldClass}>
            <label htmlFor="name" className={labelClass}>
              Nome
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={120}
              autoFocus
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="description" className={labelClass}>
              Descrição <span className="normal-case tracking-normal">(opcional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              maxLength={2000}
              rows={3}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            data-ms-magnetic
            data-ms-ripple="create"
            className="inline-flex min-h-12 items-center justify-center bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            Criar baralho
          </button>
        </form>
      </main>
    </div>
  );
}
