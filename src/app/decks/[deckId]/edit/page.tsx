import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { deckStatusLabel } from "@/components/decks/deck-status-badge";
import { SiteHeader } from "@/components/site-header";
import { updateDeckAction, updateDeckSettingsAction } from "@/features/decks/actions";
import { getDeck, type DeckStatus, type DeckWithSettings } from "@/features/decks/service";
import { auth, signOut } from "@/lib/auth";

/**
 * Editar baralho — superfície de escrita do redesign "Editorial Cognition":
 * cada campo abre com régua de 2px + kicker; inputs raio zero sobre bg-surface.
 */

const STATUS_OPTIONS: DeckStatus[] = [
  "active",
  "maintenance",
  "completed",
  "paused",
  "archived",
];

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.1em]";

const fieldClass = "border-t-2 border-divider pt-3";
const labelClass = `block ${KICKER} text-muted-foreground`;
const inputClass = "mt-2 min-h-11 w-full border-b border-border bg-surface px-3 py-2.5 text-base";

export default async function EditDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const { deckId } = await params;
  const { error, saved } = await searchParams;

  if (!/^[0-9a-f-]{36}$/i.test(deckId)) {
    notFound();
  }

  let deck: DeckWithSettings;
  try {
    deck = await getDeck(session.user.id, { deckId });
  } catch {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader>
        {session.user.role === "admin" ? (
          <Link href="/admin" className="font-semibold hover:text-primary-text">
            Admin
          </Link>
        ) : null}
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
            className="min-h-11 border border-border px-4 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-xl px-5 py-10">
        <Link
          href={`/decks/${deck.id}`}
          className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          ← {deck.name}
        </Link>
        <p className={`mt-6 ${KICKER} text-muted-foreground`}>Editar baralho</p>
        <h1 className="mt-2 truncate text-4xl font-extrabold leading-tight tracking-tight">
          {deck.name}
        </h1>

        <div aria-live="polite">
          {error ? (
            <p
              role="alert"
              className="mt-6 border border-destructive px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="mt-6 border border-border bg-surface px-4 py-3 text-sm">
              Configurações salvas.
            </p>
          ) : null}
        </div>

        <form action={updateDeckAction} className="mt-10 space-y-8">
          <input type="hidden" name="deckId" value={deck.id} />
          <div className={fieldClass}>
            <label htmlFor="name" className={labelClass}>
              Nome
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={120}
              defaultValue={deck.name}
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
              defaultValue={deck.description ?? ""}
              className={inputClass}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select id="status" name="status" defaultValue={deck.status} className={inputClass}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {deckStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            Salvar baralho
          </button>
        </form>

        <section aria-labelledby="settings-title" className="mt-14 border-t-2 border-divider pt-8">
          <p className={`${KICKER} text-muted-foreground`}>Estudo</p>
          <h2 id="settings-title" className="mt-2 text-2xl font-extrabold tracking-tight">
            Configurações de estudo
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Campos vazios usam os padrões do seu perfil.
          </p>

          <form action={updateDeckSettingsAction} className="mt-8 space-y-8">
            <input type="hidden" name="deckId" value={deck.id} />
            <div className={fieldClass}>
              <label htmlFor="desiredRetentionOverride" className={labelClass}>
                Retenção desejada <span className="normal-case tracking-normal">(0,70 a 0,98)</span>
              </label>
              <p className="text-sm text-muted-foreground">
                Quanto do conteúdo você quer lembrar na hora de revisar. Mais alto
                = revisões mais frequentes. O padrão (0,90 = 90%) serve para quase
                todo mundo — só mexa se souber o que quer.
              </p>
              <input
                id="desiredRetentionOverride"
                name="desiredRetentionOverride"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.7"
                max="0.98"
                placeholder="padrão do perfil: 0.90"
                defaultValue={deck.settings.desiredRetentionOverride ?? ""}
                className={inputClass}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor="newPerDayOverride" className={labelClass}>
                Cards novos por dia
              </label>
              <input
                id="newPerDayOverride"
                name="newPerDayOverride"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="padrão do perfil: 20"
                defaultValue={deck.settings.newPerDayOverride ?? ""}
                className={inputClass}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor="maxReviewsPerDayOverride" className={labelClass}>
                Máximo de revisões por dia
              </label>
              <input
                id="maxReviewsPerDayOverride"
                name="maxReviewsPerDayOverride"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="padrão do perfil: 200"
                defaultValue={deck.settings.maxReviewsPerDayOverride ?? ""}
                className={inputClass}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor="weeklyNewCardsGoal" className={labelClass}>
                Meta semanal de cards novos
              </label>
              <input
                id="weeklyNewCardsGoal"
                name="weeklyNewCardsGoal"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="sem meta"
                defaultValue={deck.settings.weeklyNewCardsGoal ?? ""}
                className={inputClass}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor="examDate" className={labelClass}>
                Data da prova <span className="normal-case tracking-normal">(opcional)</span>
              </label>
              <input
                id="examDate"
                name="examDate"
                type="date"
                defaultValue={deck.settings.examDate ?? ""}
                className={inputClass}
              />
            </div>
            <div className={`${fieldClass} flex min-h-11 items-center gap-3`}>
              {/* Hidden fallback: checkbox desmarcado não envia valor. */}
              <input type="hidden" name="suggestionsEnabled" value="off" />
              <input
                id="suggestionsEnabled"
                name="suggestionsEnabled"
                type="checkbox"
                value="on"
                defaultChecked={deck.settings.suggestionsEnabled}
                className="h-4 w-4 border-border accent-[var(--color-primary)]"
              />
              <label htmlFor="suggestionsEnabled" className="text-sm font-medium">
                Sugestões de cards habilitadas
              </label>
            </div>
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center border border-border px-6 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
            >
              Salvar configurações
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
