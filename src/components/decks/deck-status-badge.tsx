import type { DeckStatus } from "@/features/decks/service";

// Rótulo textual sempre presente (a11y: nunca só cor). Redesign "Editorial
// Cognition": status é TEXTO em estilo kicker — sem pílula, sem fundo; o
// glifo é decorativo e o texto é o portador da informação.
const STATUS_LABEL: Record<DeckStatus, string> = {
  active: "Ativo",
  maintenance: "Manutenção",
  completed: "Concluído",
  paused: "Pausado",
  archived: "Arquivado",
};

export function deckStatusLabel(status: DeckStatus): string {
  return STATUS_LABEL[status];
}

export function DeckStatusBadge({ status }: { status: DeckStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      <span aria-hidden="true">{status === "active" ? "■" : "□"}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
