import type { DerivedCard } from "./derive";

/**
 * Matching de cards derivados x existentes (arquitetura §5 — coração da
 * preservação de progresso na reedição). Puro e determinístico: mesma
 * entrada => mesmo plano. A aplicação do plano (UPDATEs) é da camada de
 * serviço; aqui só se decide O QUE fazer com cada card.
 */

export interface ExistingCardInfo {
  id: string;
  clozeGroupKey: string | null;
  contentFingerprint: string;
  status: "active" | "suspended" | "removed";
  variant: number;
}

export interface CardMatchPlan {
  /** Passada 1: mesmo groupKey => card mantido (fingerprint NOVO — texto pode ter mudado). */
  keep: Array<{ cardId: string; fingerprint: string }>;
  /** Passada 2: resgate por fingerprint — card antigo ganha a key nova, progresso transferido. */
  transfer: Array<{ cardId: string; newGroupKey: string; fingerprint: string }>;
  /** Passada 2b: card removed volta a active SOMENTE com fingerprint idêntico. */
  reactivate: Array<{ cardId: string; newGroupKey: string | null; fingerprint: string }>;
  /** Passada 3: derived sem dono => card novo com variant monotônico (max+1, +2, ...). */
  create: Array<{ clozeGroupKey: string | null; fingerprint: string; variant: number }>;
  /** Cards não-removed sem derived => status 'removed' (progresso e logs intactos). */
  remove: string[];
}

/**
 * Duas passadas do §5:
 * 1. por clozeGroupKey entre não-removed e derived => keep;
 * 2. resgate por fingerprint: candidato a remoção pareado 1:1 com candidato
 *    a criação de fingerprint idêntico => transfer (cobre apagar-e-recriar
 *    e recortar-e-colar);
 * 2b. removed casando por fingerprint IDÊNTICO => reactivate (1:1; entre
 *     candidatos de mesmo fingerprint, key igual tem preferência);
 * 3. restantes: derived => create (variant nunca reutilizado, inclusive de
 *    removed); não-removed => remove. Removed sem par ficam intocados.
 */
export function matchDerivedToExisting(
  existing: ExistingCardInfo[],
  derived: DerivedCard[],
): CardMatchPlan {
  // Ordenação canônica por variant (único por nota) => pareamentos determinísticos.
  const sortedExisting = [...existing].sort((a, b) => a.variant - b.variant);
  const alive = sortedExisting.filter((c) => c.status !== "removed");
  const removed = sortedExisting.filter((c) => c.status === "removed");

  const plan: CardMatchPlan = {
    keep: [],
    transfer: [],
    reactivate: [],
    create: [],
    remove: [],
  };

  const matchedExisting = new Set<string>(); // ids já com dono
  const matchedDerived = new Set<number>(); // índices de derived já com card

  // Passada 1 — por clozeGroupKey (nota basic: null casa com null).
  for (let d = 0; d < derived.length; d += 1) {
    const dc = derived[d];
    if (dc === undefined || matchedDerived.has(d)) continue;
    const card = alive.find(
      (c) => !matchedExisting.has(c.id) && c.clozeGroupKey === dc.clozeGroupKey,
    );
    if (card !== undefined) {
      matchedExisting.add(card.id);
      matchedDerived.add(d);
      plan.keep.push({ cardId: card.id, fingerprint: dc.fingerprint });
    }
  }

  // Passada 2 — resgate por fingerprint (só faz sentido com key nova, não-null).
  for (let d = 0; d < derived.length; d += 1) {
    const dc = derived[d];
    if (dc === undefined || matchedDerived.has(d) || dc.clozeGroupKey === null) {
      continue;
    }
    const card = alive.find(
      (c) =>
        !matchedExisting.has(c.id) && c.contentFingerprint === dc.fingerprint,
    );
    if (card !== undefined) {
      matchedExisting.add(card.id);
      matchedDerived.add(d);
      plan.transfer.push({
        cardId: card.id,
        newGroupKey: dc.clozeGroupKey,
        fingerprint: dc.fingerprint,
      });
    }
  }

  // Passada 2b — reativação de removed EXIGE fingerprint IDÊNTICO (#3/#9:
  // reativar por groupKey puro ressuscitaria progresso FSRS para conteúdo
  // arbitrário quando o editor recicla uma key de card removed). Key igual só
  // serve como PREFERÊNCIA de pareamento entre candidatos de mesmo fingerprint
  // (estabilidade); key reciclada com conteúdo diferente cai na passada 3 =>
  // card NOVO (variant max+1, progresso new), como manda o §5.
  for (let d = 0; d < derived.length; d += 1) {
    const dc = derived[d];
    if (dc === undefined || matchedDerived.has(d)) continue;
    const card = removed.find(
      (c) =>
        !matchedExisting.has(c.id) &&
        c.contentFingerprint === dc.fingerprint &&
        c.clozeGroupKey === dc.clozeGroupKey,
    );
    if (card !== undefined) {
      matchedExisting.add(card.id);
      matchedDerived.add(d);
      plan.reactivate.push({
        cardId: card.id,
        newGroupKey: dc.clozeGroupKey,
        fingerprint: dc.fingerprint,
      });
    }
  }
  for (let d = 0; d < derived.length; d += 1) {
    const dc = derived[d];
    if (dc === undefined || matchedDerived.has(d)) continue;
    const card = removed.find(
      (c) =>
        !matchedExisting.has(c.id) && c.contentFingerprint === dc.fingerprint,
    );
    if (card !== undefined) {
      matchedExisting.add(card.id);
      matchedDerived.add(d);
      plan.reactivate.push({
        cardId: card.id,
        newGroupKey: dc.clozeGroupKey,
        fingerprint: dc.fingerprint,
      });
    }
  }

  // Passada 3 — criações com variant monotônico (nunca reutilizado, §3.3)
  // e remoções (progresso e review_logs intactos; some das filas).
  let nextVariant =
    sortedExisting.reduce((max, c) => Math.max(max, c.variant), 0) + 1;
  for (let d = 0; d < derived.length; d += 1) {
    const dc = derived[d];
    if (dc === undefined || matchedDerived.has(d)) continue;
    plan.create.push({
      clozeGroupKey: dc.clozeGroupKey,
      fingerprint: dc.fingerprint,
      variant: nextVariant,
    });
    nextVariant += 1;
  }
  for (const card of alive) {
    if (!matchedExisting.has(card.id)) plan.remove.push(card.id);
  }

  return plan;
}
