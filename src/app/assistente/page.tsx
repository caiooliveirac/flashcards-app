import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { AssistantScreen } from "@/features/assistant/assistant-screen";
import { listDecks } from "@/features/decks/service";
import { isAiEnabled } from "@/lib/ai/config";
import { auth, signOut } from "@/lib/auth";

/**
 * Assistente de criação de cards com IA (Fase 5). Cola texto → sugestões →
 * nota/feedback/mais → adicionar ao baralho. Facultativo e à prova de falha.
 */
export default async function AssistentePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  const aiEnabled = isAiEnabled();
  const decks = aiEnabled ? await listDecks(userId) : [];

  return (
    <div className="min-h-dvh">
      <SiteHeader>
        {session.user.role === "admin" ? (
          <a href="/admin" className="hidden font-semibold underline-offset-4 hover:underline sm:inline">
            Admin
          </a>
        ) : null}
        <span className="max-w-[45vw] truncate text-muted-foreground">
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
            className="min-h-9 border border-border px-3 text-sm transition-colors duration-150 ease-out hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-3xl px-5 pb-20">
        <section className="border-b-2 border-divider py-8 sm:py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-text">
            Assistente
          </p>
          <h1 className="mt-3 text-[28px] font-extrabold leading-[1.08] sm:text-[40px]">
            Deixe a IA sugerir seus cards
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Cole uma questão ou um resumo e receba cards prontos para revisar.{" "}
            <Link href="/" className="font-semibold text-primary-text underline-offset-4 hover:underline">
              Voltar aos baralhos
            </Link>
          </p>
        </section>

        <div className="py-8">
          <AssistantScreen
            decks={decks.map((d) => ({ id: d.id, name: d.name }))}
            aiEnabled={aiEnabled}
          />
        </div>
      </main>
    </div>
  );
}
