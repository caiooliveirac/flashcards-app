import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { auth, signOut } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export default async function ContaPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
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
            data-ms-ripple="ink"
            className="min-h-11 border border-divider px-4 text-sm font-semibold hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-primary-text">
          Conta
        </p>
        <h1 className="r-display mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Sua conta
        </h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Entrou como{" "}
          <span className="font-semibold text-foreground">
            {session.user.name ?? session.user.email}
          </span>
          .
        </p>

        <section className="mt-12 border-t-2 border-divider pt-8">
          <h2 className="text-lg font-extrabold tracking-tight">Trocar senha</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Escolha uma senha só sua. Você vai precisar dela no próximo acesso.
          </p>
          <ChangePasswordForm />
        </section>
      </main>
    </div>
  );
}
