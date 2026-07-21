import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { deckStatusLabel } from "@/components/decks/deck-status-badge";
import { updateDeckAction, updateDeckSettingsAction } from "@/features/decks/actions";
import { getDeck, type DeckStatus, type DeckWithSettings } from "@/features/decks/service";
import { auth } from "@/lib/auth";

const STATUS_OPTIONS: DeckStatus[] = [
  "active",
  "maintenance",
  "completed",
  "paused",
  "archived",
];

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

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
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="truncate text-xl font-semibold">Editar baralho</h1>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← voltar
        </Link>
      </div>

      <div aria-live="polite">
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-primary px-3 py-2 text-sm text-primary"
          >
            Configurações salvas.
          </p>
        ) : null}
      </div>

      <form action={updateDeckAction} className="mt-6 space-y-4">
        <input type="hidden" name="deckId" value={deck.id} />
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
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
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">
            Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
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
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">
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
          className="rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Salvar baralho
        </button>
      </form>

      <section aria-labelledby="settings-title" className="mt-10 border-t border-border pt-6">
        <h2 id="settings-title" className="text-lg font-semibold">
          Configurações de estudo
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Campos vazios usam os padrões do seu perfil.
        </p>

        <form action={updateDeckSettingsAction} className="mt-4 space-y-4">
          <input type="hidden" name="deckId" value={deck.id} />
          <div>
            <label htmlFor="desiredRetentionOverride" className="mb-1 block text-sm font-medium">
              Retenção desejada (0,70 a 0,98)
            </label>
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
          <div>
            <label htmlFor="newPerDayOverride" className="mb-1 block text-sm font-medium">
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
          <div>
            <label htmlFor="maxReviewsPerDayOverride" className="mb-1 block text-sm font-medium">
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
          <div>
            <label htmlFor="weeklyNewCardsGoal" className="mb-1 block text-sm font-medium">
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
          <div>
            <label htmlFor="examDate" className="mb-1 block text-sm font-medium">
              Data da prova <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <input
              id="examDate"
              name="examDate"
              type="date"
              defaultValue={deck.settings.examDate ?? ""}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Hidden fallback: checkbox desmarcado não envia valor. */}
            <input type="hidden" name="suggestionsEnabled" value="off" />
            <input
              id="suggestionsEnabled"
              name="suggestionsEnabled"
              type="checkbox"
              value="on"
              defaultChecked={deck.settings.suggestionsEnabled}
              className="h-4 w-4 rounded border-border accent-[var(--color-primary)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            />
            <label htmlFor="suggestionsEnabled" className="text-sm font-medium">
              Sugestões de cards habilitadas
            </label>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-border px-4 py-2.5 font-medium outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Salvar configurações
          </button>
        </form>
      </section>
    </main>
  );
}
