import Link from "next/link";
import { listUsers } from "@/features/admin/service";
import { requireAdmin } from "@/lib/auth/require-admin";
import { setPasswordAction } from "./actions";

export default async function AdminPage() {
  await requireAdmin();
  const userRows = await listUsers();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Admin — usuários</h1>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← voltar
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Trocas de senha e visualização de conteúdo são registradas em audit_logs.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Usuário</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Senha</th>
              <th className="px-3 py-2 font-medium">Definir senha</th>
              <th className="px-3 py-2 font-medium">Conteúdo</th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">{u.username ?? u.name ?? "—"}</td>
                <td className="px-3 py-2">{u.email ?? "—"}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.hasPassword ? "definida" : "—"}</td>
                <td className="px-3 py-2">
                  <form action={setPasswordAction} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <label className="sr-only" htmlFor={`pw-${u.id}`}>
                      Nova senha para {u.username ?? u.email ?? u.id}
                    </label>
                    <input
                      id={`pw-${u.id}`}
                      name="password"
                      type="password"
                      required
                      minLength={4}
                      autoComplete="new-password"
                      className="w-36 rounded-md border border-border bg-background px-2 py-1"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-2 py-1 outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Salvar
                    </button>
                  </form>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    ver flashcards
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
