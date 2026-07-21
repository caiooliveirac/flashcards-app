import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-semibold">Flashcards</span>
          <div className="flex items-center gap-3">
            {session.user.role === "admin" ? (
              <a
                href="/admin"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Admin
              </a>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {session.user.email ?? session.user.name}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1.5 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <h1 className="text-xl font-semibold">Nenhum baralho ainda</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A criação de baralhos e cards chega na Fase 2. Esta é a fundação
            autenticada do app.
          </p>
        </div>
      </main>
    </div>
  );
}
