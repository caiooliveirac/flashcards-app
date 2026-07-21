/**
 * Convenção única de "dia de estudo" (arquitetura §7.4).
 *
 * Dia de estudo = data local do usuário (`user_profiles.timezone`) com corte em
 * `user_profiles.day_start_hour` (default 4h). Antes do corte, o instante ainda
 * pertence ao dia CIVIL anterior. A MESMA convenção vale para: limites diários,
 * `daily_study_metrics`, "devido hoje", `buried_until` do sibling burial e o
 * `next_day_starts_at` do otimizador FSRS.
 *
 * Puro, sem dependências — usa apenas `Intl.DateTimeFormat` (IANA tz + DST).
 */

export interface StudyDayConfig {
  timezone: string;
  /** Hora de corte 0–23 (default 4). */
  dayStartHour: number;
}

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  second: number;
}

/** Componentes da hora de parede (wall clock) do instante no fuso dado. */
function localPartsOf(instant: Date, timezone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year!,
    month: map.month!,
    day: map.day!,
    // h23 pode emitir "24" para meia-noite em alguns motores — normaliza p/ 0.
    hour: map.hour! % 24,
    minute: map.minute!,
    second: map.second!,
  };
}

/** Offset (ms) do fuso em relação ao UTC no instante dado (positivo a leste). */
function offsetMsOf(instant: Date, timezone: string): number {
  const p = localPartsOf(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * Converte uma hora de parede num fuso para o instante UTC correspondente.
 * Dupla passada resolve transições de DST (o offset do "chute" pode diferir
 * do offset real no instante resultante).
 */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const offset1 = offsetMsOf(new Date(guess), timezone);
  const utc1 = guess - offset1;
  const offset2 = offsetMsOf(new Date(utc1), timezone);
  if (offset1 === offset2) return new Date(utc1);
  // Transição DST entre o chute e o resultado: reprojeta com o offset real.
  return new Date(guess - offset2);
}

/** Data civil (ano/mês/dia) shiftada por `deltaDays`, aritmética segura via UTC. */
function shiftDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Data civil do dia de estudo a que o instante pertence (aplicado o corte).
 * Retorna `{ year, month, day }` já ajustado.
 */
function studyDayDate(
  instant: Date,
  { timezone, dayStartHour }: StudyDayConfig,
): { year: number; month: number; day: number } {
  const p = localPartsOf(instant, timezone);
  // Antes do corte → pertence ao dia civil anterior.
  const delta = p.hour < dayStartHour ? -1 : 0;
  return shiftDate(p.year, p.month, p.day, delta);
}

/** Dia de estudo como string `YYYY-MM-DD` (chave de `daily_study_metrics`). */
export function studyDayKey(instant: Date, config: StudyDayConfig): string {
  const { year, month, day } = studyDayDate(instant, config);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Instante UTC em que o dia de estudo CORRENTE começou. */
export function studyDayStart(instant: Date, config: StudyDayConfig): Date {
  const { year, month, day } = studyDayDate(instant, config);
  return zonedWallToUtc(year, month, day, config.dayStartHour, config.timezone);
}

/** Instante UTC em que o PRÓXIMO dia de estudo começa (corte do dia seguinte). */
export function nextStudyDayStart(instant: Date, config: StudyDayConfig): Date {
  const { year, month, day } = studyDayDate(instant, config);
  const next = shiftDate(year, month, day, 1);
  return zonedWallToUtc(next.year, next.month, next.day, config.dayStartHour, config.timezone);
}
