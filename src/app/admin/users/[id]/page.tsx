import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserFlashcards } from "@/features/admin/service";
import { requireAdmin } from "@/lib/auth/require-admin";

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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/admin"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← usuários
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        Flashcards de {content.user.username ?? content.user.name ?? content.user.email}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Acesso registrado em audit_logs (admin.view_flashcards).
      </p>
      {content.decks.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Este usuário ainda não tem baralhos.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Baralho</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Notas</th>
                <th className="px-3 py-2 font-medium">Cards</th>
              </tr>
            </thead>
            <tbody>
              {content.decks.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2">{d.name}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2">{d.noteCount}</td>
                  <td className="px-3 py-2">{d.cardCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
