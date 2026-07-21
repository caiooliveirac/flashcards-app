import type {
  ActivitySummary,
  FutureDue,
  RetentionBucket,
  TrueRetention,
} from "./queries";

/**
 * Componentes do dashboard (Fase 4) — server components puros, desenhados em
 * CSS/SVG (sem lib de gráfico) para casar com o design "Editorial Cognition"
 * (cantos retos, réguas divider, acento) e renderizar no servidor sem JS.
 */

const KICKER = "text-[11px] uppercase tracking-[0.1em] font-semibold";

function pct(b: RetentionBucket): string {
  return b.pct == null ? "—" : `${Math.round(b.pct * 100)}%`;
}

function RetentionRow({ label, b }: { label: string; b: RetentionBucket }) {
  const width = b.pct == null ? 0 : Math.round(b.pct * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">
          {pct(b)} <span className="text-xs">({b.num}/{b.den})</span>
        </span>
      </div>
      <div className="mt-1.5 h-[3px] bg-track">
        <div className="h-full bg-foreground" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function RetentionSection({ data }: { data: TrueRetention }) {
  return (
    <section className="py-8 sm:py-10">
      <div className="flex items-baseline justify-between pb-4">
        <h2 className={`${KICKER} text-muted-foreground`}>Retenção real</h2>
        <span className="text-xs text-muted-foreground">últimos {data.days} dias</span>
      </div>
      {data.overall.den === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ainda sem revisões neste período — revise alguns cards e volte aqui.
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-3">
            <span className="text-5xl font-extrabold text-primary-text sm:text-6xl">
              {pct(data.overall)}
            </span>
            <span className="text-sm text-muted-foreground">
              acertos na 1ª revisão do dia<br />
              {data.overall.num} de {data.overall.den} cards
            </span>
          </p>
          <div className="mt-6 space-y-4 border-t-2 border-divider pt-5">
            <RetentionRow label="Maduros (intervalo ≥ 21 dias)" b={data.mature} />
            <RetentionRow label="Jovens (aprendendo)" b={data.young} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Errei = falha; Difícil, Bom e Fácil = acerto. Cards maduros medem a memória
            de longo prazo — é neles que a retenção importa.
          </p>
        </>
      )}
    </section>
  );
}

// ---- Heatmap de atividade -------------------------------------------------

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
function toKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** 4 níveis de intensidade por nº de revisões (bordas simples, sem escala fina). */
function level(reviews: number): 0 | 1 | 2 | 3 | 4 {
  if (reviews <= 0) return 0;
  if (reviews < 10) return 1;
  if (reviews < 30) return 2;
  if (reviews < 60) return 3;
  return 4;
}
const LEVEL_BG = [
  "bg-track",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/75",
  "bg-primary",
] as const;

export function ActivitySection({
  data,
  todayKey,
  weeks = 18,
}: {
  data: ActivitySummary;
  todayKey: string;
  weeks?: number;
}) {
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const totalTimeMs = data.days.reduce((s, d) => s + d.timeMs, 0);
  const totalMin = Math.round(totalTimeMs / 60_000);

  // Grade alinhada por semana (domingo em cima), última coluna contém hoje.
  const today = parseKey(todayKey);
  const startSunday = new Date(today);
  startSunday.setUTCDate(startSunday.getUTCDate() - today.getUTCDay() - (weeks - 1) * 7);
  const cells: { key: string; reviews: number; future: boolean }[] = [];
  for (let c = 0; c < weeks * 7; c++) {
    const date = new Date(startSunday);
    date.setUTCDate(date.getUTCDate() + c);
    const key = toKey(date);
    cells.push({ key, reviews: byDay.get(key)?.reviews ?? 0, future: date > today });
  }

  return (
    <section className="border-t-2 border-divider py-8 sm:py-10">
      <div className="flex items-baseline justify-between pb-4">
        <h2 className={`${KICKER} text-muted-foreground`}>Constância</h2>
        <span className="text-xs text-muted-foreground">
          {totalMin} min em {data.days.length} {data.days.length === 1 ? "dia" : "dias"}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold text-primary-text sm:text-5xl">
            {data.currentStreak}
          </span>
          <span className="text-sm text-muted-foreground">
            {data.currentStreak === 1 ? "dia seguido" : "dias seguidos"}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {data.studiedToday ? "✓ você já estudou hoje" : "estude hoje para manter a sequência"}
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}
          aria-hidden="true"
        >
          {cells.map((cell) =>
            cell.future ? (
              <div key={cell.key} className="size-3 sm:size-[13px]" />
            ) : (
              <div
                key={cell.key}
                title={`${cell.key}: ${cell.reviews} ${cell.reviews === 1 ? "revisão" : "revisões"}`}
                className={`size-3 sm:size-[13px] ${LEVEL_BG[level(cell.reviews)]}`}
              />
            ),
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Estudar <span className="font-semibold text-foreground">todo dia</span>, mesmo pouco,
        vale mais que sessões longas espaçadas — a ciência é clara nisso.
      </p>
    </section>
  );
}

// ---- Future Due -----------------------------------------------------------

function shortDay(key: string): string {
  const d = parseKey(key);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(d)
    .replace(".", "");
}

export function FutureDueSection({ data, todayKey }: { data: FutureDue; todayKey: string }) {
  const shown = data.buckets.slice(0, 14);
  const max = Math.max(1, ...shown.map((b) => b.count));
  return (
    <section className="border-t-2 border-divider py-8 sm:py-10">
      <div className="flex items-baseline justify-between pb-4">
        <h2 className={`${KICKER} text-muted-foreground`}>Próximas revisões</h2>
        <span className="text-xs text-muted-foreground">próximos {shown.length - 1} dias</span>
      </div>

      {data.backlog > 0 ? (
        <p className="mb-5 border-2 border-divider bg-surface px-4 py-3 text-sm">
          <span className="font-extrabold text-primary-text">{data.backlog}</span>{" "}
          {data.backlog === 1 ? "revisão atrasada" : "revisões atrasadas"} — comece por elas
          antes de adicionar cards novos.
        </p>
      ) : null}

      <div className="space-y-1.5">
        {shown.map((b, i) => {
          const width = Math.round((b.count / max) * 100);
          const isToday = b.day === todayKey;
          return (
            <div key={b.day} className="flex items-center gap-3 text-sm">
              <span
                className={`w-16 shrink-0 text-xs ${isToday ? "font-extrabold text-primary-text" : "text-muted-foreground"}`}
              >
                {i === 0 ? "hoje" : shortDay(b.day)}
              </span>
              <div className="h-4 flex-1 bg-track">
                <div
                  className={`h-full ${isToday ? "bg-primary" : "bg-foreground"}`}
                  style={{ width: `${b.count === 0 ? 0 : Math.max(2, width)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
                {b.count}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Retenção desejada ----------------------------------------------------

export function DesiredRetentionSection({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const inRange = percent >= 80 && percent <= 95;
  return (
    <section className="border-t-2 border-divider py-8 sm:py-10">
      <h2 className={`${KICKER} pb-4 text-muted-foreground`}>Meta de memória</h2>
      <p className="flex items-baseline gap-3">
        <span className="text-4xl font-extrabold sm:text-5xl">{percent}%</span>
        <span className="text-sm text-muted-foreground">
          é a chance de acerto que você mira em cada card (retenção desejada)
        </span>
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        {inRange
          ? "Está na faixa recomendada (80–95%). Mais alto = revisar mais vezes; mais baixo = esquecer mais."
          : "A faixa recomendada é 80–95% (≈90% para a maioria). Fora dela você estuda mais para lembrar menos."}
      </p>
    </section>
  );
}
