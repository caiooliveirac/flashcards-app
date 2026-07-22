import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { listUsers } from "@/features/admin/service";
import { signOut } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth/require-admin";
import { setPasswordAction } from "./actions";

const KICKER_TH =
  "px-3 py-3 text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground";

export default async function AdminPage() {
  const session = await requireAdmin();
  const userRows = await listUsers();

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
            data-ms-ripple="ink"
            className="min-h-11 border border-divider px-4 text-sm font-semibold hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-primary-text">
          Admin
        </p>
        <h1 className="mt-2 text-[32px] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[44px]">
          Usuários
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Trocas de senha e visualização de conteúdo são registradas em audit_logs.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b-2 border-divider">
                <th className={KICKER_TH}>Usuário</th>
                <th className={KICKER_TH}>E-mail</th>
                <th className={KICKER_TH}>Role</th>
                <th className={KICKER_TH}>Senha</th>
                <th className={KICKER_TH}>Definir senha</th>
                <th className={KICKER_TH}>Conteúdo</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => (
                <tr key={u.id} className="border-b border-border">
                  <td className="px-3 py-3 font-semibold">
                    {u.username ?? u.name ?? "—"}
                  </td>
                  <td className="px-3 py-3">{u.email ?? "—"}</td>
                  <td className="px-3 py-3">{u.role}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {u.hasPassword ? "definida" : "—"}
                  </td>
                  <td className="px-3 py-3">
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
                        className="min-h-11 w-36 border-0 border-b-2 border-divider bg-surface px-2"
                      />
                      <button
                        type="submit"
                        data-ms-ripple="ink"
                        className="min-h-11 border border-divider px-3 font-semibold hover:bg-surface"
                      >
                        Salvar
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="font-semibold text-primary-text underline-offset-4 hover:underline"
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
    </div>
  );
}
