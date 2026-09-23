import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getUserDeckNotes } from "@/features/admin/service";
import { requireAdmin } from "@/lib/auth/require-admin";
import { renderNoteContent } from "@/lib/render";

// Mídia de outro usuário não passa pela rota autenticada (RLS do dono) — o
// admin vê o texto; imagens aparecem quebradas, o que é aceitável aqui.
function mediaUrl(assetId: string, thumb?: boolean): string {
  return `/api/media/${assetId}${thumb ? "?thumb=1" : ""}`;
}

export default async function AdminDeckNotesPage({
  params,
}: {
  params: Promise<{ id: string; deckId: string }>;
}) {
  const session = await requireAdmin();
  const { id, deckId } = await params;

  let content;
  try {
    content = await getUserDeckNotes(session.user.id, id, deckId);
  } catch {
    notFound();
  }
  const owner = content.user.username ?? content.user.name ?? content.user.email;

  return (
    <div className="min-h-dvh">
      <SiteHeader isAdmin />

      <main className="mx-auto max-w-3xl px-5 py-10">
        <Link
          href={`/admin/users/${content.user.id}`}
          className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          ← baralhos de {owner}
        </Link>
        <p className="mt-6 text-[11px] font-semibold tracking-[0.1em] uppercase text-primary-text">
          Admin · somente leitura
        </p>
        <h1 className="mt-2 text-[32px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[44px]">
          {content.deck.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {content.notes.length} {content.notes.length === 1 ? "nota" : "notas"} de {owner}. Acesso
          registrado em audit_logs (admin.view_deck_notes).
        </p>

        {content.notes.length === 0 ? (
          <p className="mt-8 border-t-2 border-divider pt-8 text-sm text-muted-foreground">
            Baralho vazio.
          </p>
        ) : (
          <ol className="mt-8 space-y-4">
            {content.notes.map((n, i) => (
              <li key={n.id} className="border-2 border-divider p-4">
                <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
                  {i + 1} · {n.noteType === "basic" ? "básico" : "cloze"}
                </p>
                {/* Sem opção de cloze = todas as ocultações reveladas. */}
                {renderNoteContent(n.content, { mediaUrl })}
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
