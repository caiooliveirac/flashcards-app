import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getUserFlashcards } from "@/features/admin/service";
import { signOut } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth/require-admin";

const KICKER_TH =
  "px-3 py-3 text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground";

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;

  let content;
  try {
    content = await getUserFlashcards(session.user.id, id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader>
        <span className="hidden text-muted-foreground sm:inline">
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
            className="min-h-11 border border-divider px-4 text-sm font-semibold hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <Link
          href="/admin"
          className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          ← usuários
        </Link>
        <p className="mt-6 text-[11px] font-semibold tracking-[0.1em] uppercase text-primary-text">
          Admin
        </p>
        <h1 className="mt-2 text-[32px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[44px]">
          Flashcards de{" "}
          {content.user.username ?? content.user.name ?? content.user.email}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Acesso registrado em audit_logs (admin.view_flashcards).
        </p>

        {content.decks.length === 0 ? (
          <p className="mt-8 border-t-2 border-divider pt-8 text-sm text-muted-foreground">
            Este usuário ainda não tem baralhos.
          </p>
        ) : (
          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b-2 border-divider">
                  <th className={KICKER_TH}>Baralho</th>
                  <th className={KICKER_TH}>Status</th>
                  <th className={KICKER_TH}>Notas</th>
                  <th className={KICKER_TH}>Cards</th>
                </tr>
              </thead>
              <tbody>
                {content.decks.map((d) => (
                  <tr key={d.id} className="border-b border-border">
                    <td className="px-3 py-3 font-semibold">{d.name}</td>
                    <td className="px-3 py-3">{d.status}</td>
                    <td className="px-3 py-3">{d.noteCount}</td>
                    <td className="px-3 py-3">{d.cardCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
