import Link from "next/link";
import { redirect } from "next/navigation";
import { DeckMenu } from "@/components/decks/deck-menu";
import { SiteHeader } from "@/components/site-header";
import { deckActivityByDeck } from "@/features/decks/home-queries";
import { listDecks, type DeckListItem } from "@/features/decks/service";
import { deckTemperatures, type DeckTemperature } from "@/features/decks/temperature";
import { reviewCountsByDeck } from "@/features/review/service";
import { auth, signOut } from "@/lib/auth";
import { KineticText } from "@/lib/motion/components";
import { tiltForTemperature } from "@/lib/motion/tokens";

const KICKER = "text-[11px] uppercase tracking-[0.1em] font-semibold";
const HIBERNATION_DAYS = 14;
const BACKLOG_THRESHOLD = 40;
const TRIAGE_SIZE = 20;
const SECONDS_PER_REVIEW = 40;

const FROZEN_TEMP: DeckTemperature = { score: 0, tier: "frio", label: "Frio" };

interface HomeDeck {
  deck: DeckListItem;
  dueCount: number;
  newCount: number;
  lastNoteAt: Date | null;
  lastReviewAt: Date | null;
  temp: DeckTemperature;
}

/** Cor do rótulo de temperatura por faixa (§8: sempre cor + ícone + rótulo). */
const TEMP_CLASS: Record<DeckTemperature["tier"], string> = {
  frio: "text-muted-foreground",
  morno: "text-foreground",
  quente: "text-primary-text",
  "muito-quente": "text-primary-text",
  critico: "text-primary-text",
};

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Segunda, 21 de julho" — derivado da data do servidor, pt-BR. */
function formatDateKicker(now: Date): string {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  })
    .format(now)
    .replace("-feira", "");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function relativeDayLabel(date: Date, now: Date): string {
  const days = daysBetween(date, now);
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 14) return `há ${days} dias`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "há 1 semana" : `há ${weeks} semanas`;
  }
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

/** Estimativa (~40 s por revisão) — sempre exibida com "~". */
function minutesLabel(reviews: number): string {
  const minutes = Math.max(1, Math.round((reviews * SECONDS_PER_REVIEW) / 60));
  return `~${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

function isHibernating(d: HomeDeck, now: Date): boolean {
  if (d.deck.status === "paused" || d.deck.status === "archived") return true;
  return (
    d.dueCount === 0 &&
    d.newCount === 0 &&
    d.lastNoteAt != null &&
    daysBetween(d.lastNoteAt, now) >= HIBERNATION_DAYS
  );
}

/** Rótulo do canto do card: temperatura real quando há revisões; senão frescor. */
function deckKicker(
  d: HomeDeck,
  urgent: boolean,
): { text: string; className: string; title?: string } {
  if (d.dueCount > 0) {
    return {
      text: `${urgent ? "■" : "□"} ${d.temp.label}`,
      className: TEMP_CLASS[d.temp.tier],
      title: `Temperatura ${d.temp.score}/100 · ${d.dueCount} a revisar. Quanto mais quente, mais frágil está a memória deste baralho.`,
    };
  }
  if (d.newCount > 0) {
    return {
      text: `□ Crescendo · ${pluralize(d.newCount, "novo", "novos")}`,
      className: "text-muted-foreground",
    };
  }
  return { text: "□ Em dia", className: "text-muted-foreground" };
}

function metaLine(d: HomeDeck, now: Date): string {
  const parts = [pluralize(d.deck.cardCount, "card", "cards")];
  if (d.newCount > 0) parts.push(pluralize(d.newCount, "novo", "novos"));
  const lastActivity = d.lastReviewAt ?? d.lastNoteAt;
  if (lastActivity) parts.push(relativeDayLabel(lastActivity, now));
  return parts.join(" · ");
}

function hibernationLabel(d: HomeDeck, now: Date): string {
  if (d.lastNoteAt) {
    const days = daysBetween(d.lastNoteAt, now);
    return days >= 2 ? `hiberna há ${days} dias` : "hiberna";
  }
  if (d.deck.status === "paused") return "está pausado";
  if (d.deck.status === "archived") return "está arquivado";
  return "hiberna";
}

function DeckCell({
  item,
  urgent,
  backlog,
  now,
}: {
  item: HomeDeck;
  urgent: boolean;
  backlog: boolean;
  now: Date;
}) {
  const { deck, dueCount } = item;
  // O calor é físico: quanto mais quente o baralho, mais ele inclina (handoff §7).
  const tilt = dueCount > 0 ? tiltForTemperature(item.temp.tier) : 4;
  return (
    <article
      data-ms-tilt={tilt}
      // Pilha e spotlight são exclusivos do baralho urgente (handoff §7): é ele
      // que tem massa de cartas atrás e é nele que o accent significa algo.
      {...(urgent ? { "data-ms-spotlight": "always" } : {})}
      className={`flex flex-col p-5 sm:p-6 ${
        urgent ? `ms-stack r-lift ${backlog ? "bg-urgent-strong" : "bg-urgent"}` : "bg-background"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {(() => {
          const kicker = deckKicker(item, urgent);
          return (
            <p className={`${KICKER} ${kicker.className}`} title={kicker.title}>
              {kicker.text}
            </p>
          );
        })()}
        <DeckMenu deckId={deck.id} deckName={deck.name} status={deck.status} />
      </div>
      <h3
        className={`mt-3 font-extrabold ${
          urgent ? "text-2xl leading-tight sm:text-3xl" : "text-lg leading-snug"
        }`}
      >
        <Link href={`/decks/${deck.id}`} className="underline-offset-4 hover:underline">
          {deck.name}
        </Link>
      </h3>
      <p className="mt-auto pt-5">
        <span
          className={`block font-extrabold ${
            urgent
              ? "text-5xl text-primary-text sm:text-6xl"
              : `text-3xl ${dueCount > 0 ? "text-foreground" : "text-muted-foreground"}`
          }`}
        >
          {dueCount}
        </span>
        <span className="text-xs text-muted-foreground">a revisar</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{metaLine(item, now)}</p>
      {dueCount > 0 ? (
        <Link
          href={`/decks/${deck.id}/review`}
          data-ms-press
          data-ms-magnetic
          data-ms-ripple="ink"
          className="mt-3 inline-flex min-h-11 items-center self-start text-sm font-semibold underline-offset-4 hover:underline"
        >
          Revisar →
        </Link>
      ) : null}
    </article>
  );
}

const CREATION_MODES = [
  {
    number: "01",
    title: "Pergunta e resposta",
    description: "Escreva a frente e o verso do card — o formato clássico de revisão.",
  },
  {
    number: "02",
    title: "Ocultar trecho",
    description: "Marque trechos de um texto para transformá-los em lacunas.",
  },
  {
    number: "03",
    title: "A partir de um print",
    description: "Envie uma captura de tela do seu material e monte cards a partir dela.",
  },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const { error } = await searchParams;
  const [deckRows, reviewCounts, activity, temperatures] = await Promise.all([
    listDecks(session.user.id),
    reviewCountsByDeck(session.user.id),
    deckActivityByDeck(session.user.id),
    deckTemperatures(session.user.id),
  ]);

  const now = new Date();
  const dateKicker = formatDateKicker(now);

  const homeDecks: HomeDeck[] = deckRows.map((deck) => {
    const counts = reviewCounts.get(deck.id) ?? { dueCount: 0, newCount: 0 };
    const act = activity.get(deck.id);
    return {
      deck,
      dueCount: counts.dueCount,
      newCount: counts.newCount,
      lastNoteAt: act?.lastNoteAt ?? null,
      lastReviewAt: act?.lastReviewAt ?? null,
      temp: temperatures.get(deck.id) ?? FROZEN_TEMP,
    };
  });

  const hibernating = homeDecks.filter((d) => isHibernating(d, now));
  const active = homeDecks.filter((d) => !isHibernating(d, now));

  // O baralho em destaque é o mais QUENTE (memória mais frágil), não só o de
  // maior contagem — desempate por dueCount. Só concorre quem tem revisão devida.
  let urgentDeck: HomeDeck | null = null;
  for (const d of active) {
    if (d.dueCount === 0) continue;
    if (
      urgentDeck === null ||
      d.temp.score > urgentDeck.temp.score ||
      (d.temp.score === urgentDeck.temp.score && d.dueCount > urgentDeck.dueCount)
    ) {
      urgentDeck = d;
    }
  }
  const calmDecks = active.filter((d) => d !== urgentDeck);
  const gridDecks = urgentDeck ? [urgentDeck, ...calmDecks] : calmDecks;
  const gridRemainder = gridDecks.length % 3 === 0 ? 0 : 3 - (gridDecks.length % 3);

  const totalDue = homeDecks.reduce((sum, d) => sum + d.dueCount, 0);
  const totalNew = homeDecks.reduce((sum, d) => sum + d.newCount, 0);
  const totalCards = homeDecks.reduce((sum, d) => sum + d.deck.cardCount, 0);
  const backlog = totalDue >= BACKLOG_THRESHOLD;
  const hasDecks = deckRows.length > 0;

  let headline: string;
  let subline: string;
  if (totalDue === 0) {
    headline = "Tudo em dia.";
    subline = `${pluralize(deckRows.length, "baralho", "baralhos")} · ${pluralize(totalCards, "card", "cards")}. ${
      totalNew > 0
        ? `${pluralize(totalNew, "card novo esperando", "cards novos esperando")}.`
        : "Nada pendente por agora."
    }`;
  } else if (backlog) {
    headline = `${totalDue} revisões acumuladas. Comece pelas ${TRIAGE_SIZE} mais urgentes.`;
    subline = `As primeiras ${TRIAGE_SIZE} levam ${minutesLabel(TRIAGE_SIZE)}.`;
  } else if (urgentDeck && urgentDeck.dueCount === totalDue) {
    headline = `${totalDue === 1 ? "1 revisão pronta" : `${totalDue} revisões prontas`} em ${urgentDeck.deck.name}.`;
    subline = `Começar agora leva ${minutesLabel(totalDue)}.`;
  } else {
    headline = `${totalDue} revisões prontas. ${urgentDeck?.deck.name} responde por ${urgentDeck?.dueCount}.`;
    subline = `Começar agora leva ${minutesLabel(totalDue)}.`;
  }

  const createTargetDeck = urgentDeck ?? gridDecks[0] ?? hibernating[0];
  const createHref = createTargetDeck ? `/decks/${createTargetDeck.deck.id}/new` : "/decks/new";
  // Com backlog, a revisão entra em modo RESGATE (mais frágeis primeiro, §8).
  const reviewSuffix = backlog ? "?mode=rescue" : "";

  return (
    <div className="min-h-dvh">
      <SiteHeader isAdmin={session.user.role === "admin"}>
        {session.user.role === "admin" ? (
          <a
            href="/admin"
            className="hidden font-semibold underline-offset-4 hover:underline sm:inline"
          >
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

      <main className="mx-auto max-w-5xl px-5 pb-28 sm:pb-16">
        {error ? (
          <p role="alert" className="mt-6 border-2 border-divider bg-surface px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        {!hasDecks ? (
          <section className="py-10 sm:py-14">
            <p className={`${KICKER} text-primary-text`}>{dateKicker}</p>
            <h1 className="r-display mt-3 max-w-3xl text-balance text-[28px] font-extrabold leading-[1.08] sm:text-[48px] sm:leading-[1.05]">
              A sua primeira edição começa com um baralho.
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
              Três formas de transformar o que você estuda em cards de revisão:
            </p>
            <ol className="mt-8 max-w-2xl border-t-2 border-divider">
              {CREATION_MODES.map((mode) => (
                <li key={mode.number} className="flex gap-5 border-b border-border py-5">
                  <span className="pt-0.5 text-sm font-extrabold text-muted-foreground">
                    {mode.number}
                  </span>
                  <div>
                    <h2 className="font-extrabold">{mode.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{mode.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/decks/new"
              data-ms-press
              data-ms-magnetic
              data-ms-ripple="create"
              className="mt-8 hidden min-h-12 items-center bg-primary px-6 font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover sm:inline-flex"
            >
              Criar primeiro baralho
            </Link>
          </section>
        ) : (
          <>
            <section
              className={`border-b-2 border-divider py-8 sm:py-12 ${urgentDeck ? "r-halo" : ""}`}
            >
              <p className={`${KICKER} text-primary-text`}>{dateKicker}</p>
              {/* Headline entra palavra a palavra — stamp editorial (handoff §7 · 4e) */}
              <KineticText
                as="h1"
                text={headline}
                by="word"
                className="r-display mt-3 block max-w-3xl text-balance text-[28px] font-extrabold leading-[1.08] sm:text-[48px] sm:leading-[1.05]"
              />
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">{subline}</p>
              {urgentDeck ? (
                <Link
                  href={`/decks/${urgentDeck.deck.id}/review${reviewSuffix}`}
                  data-ms-press
                  data-ms-magnetic
                  data-ms-ripple={backlog ? "accent" : "ink"}
                  className="mt-6 hidden min-h-11 items-center bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover sm:inline-flex"
                >
                  {backlog ? "Recuperar atrasados" : "Começar revisão"}
                </Link>
              ) : null}
            </section>

            <section className="py-6 sm:py-8">
              <div className="flex items-center justify-between pb-4">
                <h2 className={`${KICKER} text-muted-foreground`}>Baralhos</h2>
                <Link
                  href="/decks/new"
                  data-ms-press
                  data-ms-magnetic
                  data-ms-ripple="create"
                  className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline"
                >
                  + Novo baralho
                </Link>
              </div>

              {gridDecks.length > 0 ? (
                <div className="flex flex-col gap-px border-y-2 border-divider bg-border sm:grid sm:grid-cols-[2fr_1fr_1fr]">
                  {gridDecks.map((item) => (
                    <DeckCell
                      key={item.deck.id}
                      item={item}
                      urgent={item === urgentDeck}
                      backlog={backlog}
                      now={now}
                    />
                  ))}
                  {gridRemainder > 0 ? (
                    <div
                      aria-hidden="true"
                      className={`hidden bg-background sm:block ${
                        gridRemainder === 2 ? "sm:col-span-2" : ""
                      }`}
                    />
                  ) : null}
                </div>
              ) : null}

              {hibernating.length > 0 ? (
                <ul className={gridDecks.length === 0 ? "border-t-2 border-divider" : ""}>
                  {hibernating.map((item) => (
                    <li
                      key={item.deck.id}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 text-sm text-muted-foreground"
                    >
                      <p>
                        <span className="font-semibold text-foreground">{item.deck.name}</span>{" "}
                        {hibernationLabel(item, now)} ·{" "}
                        <Link
                          href={`/decks/${item.deck.id}/new`}
                          className="font-semibold text-primary-text underline-offset-4 hover:underline"
                        >
                          adicionar conhecimento
                        </Link>
                      </p>
                      <DeckMenu
                        deckId={item.deck.id}
                        deckName={item.deck.name}
                        status={item.deck.status}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </>
        )}
      </main>

      {/* Barra de ação fixa — apenas mobile. data-mobile-dock: o FAB do
          Preceptor lê esta marca para subir e não cobrir a barra (globals.css). */}
      <div
        data-mobile-dock
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-divider bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="flex gap-3 px-4 py-3">
          {urgentDeck ? (
            <>
              <Link
                href={`/decks/${urgentDeck.deck.id}/review${reviewSuffix}`}
                data-ms-press
                data-ms-ripple={backlog ? "accent" : "ink"}
                className="flex min-h-12 flex-1 items-center justify-center bg-primary px-4 font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
              >
                {backlog ? "Recuperar" : "Revisar"} — {totalDue}
              </Link>
              <Link
                href={createHref}
                data-ms-press
                data-ms-ripple="create"
                className="flex min-h-12 items-center justify-center border border-divider px-5 font-semibold text-foreground"
              >
                Criar
              </Link>
            </>
          ) : hasDecks ? (
            <Link
              href={createHref}
              data-ms-press
              data-ms-ripple="create"
              className="flex min-h-12 flex-1 items-center justify-center border border-divider px-4 font-semibold text-foreground"
            >
              Criar
            </Link>
          ) : (
            <Link
              href="/decks/new"
              data-ms-press
              data-ms-ripple="create"
              className="flex min-h-12 flex-1 items-center justify-center bg-primary px-4 font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
            >
              Criar primeiro baralho
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
