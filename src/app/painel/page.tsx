import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  ActivitySection,
  DesiredRetentionSection,
  FutureDueSection,
  RetentionSection,
} from "@/features/stats/components";
import {
  getActivity,
  getDesiredRetention,
  getFutureDue,
  getTrueRetention,
} from "@/features/stats/queries";
import { auth, signOut } from "@/lib/auth";

/**
 * Painel de estudo (Fase 4, MVP). As 4 peças de maior valor da pesquisa
 * (docs/architecture/research/fase-4-dashboard-pesquisa.md): retenção real
 * jovem×maduro, constância (heatmap+streak), próximas revisões e meta de memória.
 */
export default async function PainelPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  const [retention, activity, futureDue, desired] = await Promise.all([
    getTrueRetention(userId, { days: 30 }),
    getActivity(userId, { days: 140 }),
    getFutureDue(userId, { days: 30 }),
    getDesiredRetention(userId),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader isAdmin={session.user.role === "admin"}>
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
            data-ms-ripple="ink"
            className="min-h-9 border border-border px-3 text-sm transition-colors duration-150 ease-out hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-3xl px-5 pb-20">
        <section className="border-b-2 border-divider py-8 sm:py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-text">
            Painel
          </p>
          <h1 className="r-display mt-3 text-[28px] font-extrabold leading-[1.08] sm:text-[40px]">
            Como anda a sua memória
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Números do seu estudo — retenção, constância e o que vem pela frente.{" "}
            <Link href="/" className="font-semibold text-primary-text underline-offset-4 hover:underline">
              Voltar aos baralhos
            </Link>
          </p>
        </section>

        <RetentionSection data={retention} />
        <ActivitySection data={activity} todayKey={activity.todayKey} />
        <FutureDueSection data={futureDue} todayKey={activity.todayKey} />
        <DesiredRetentionSection value={desired} />
      </main>
    </div>
  );
}
