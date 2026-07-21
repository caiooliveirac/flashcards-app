import type { DeckStatus } from "@/features/decks/service";

// Rótulo textual sempre presente (a11y: nunca só cor). Cores discretas dos
// tokens existentes — o texto é o portador da informação.
const STATUS_META: Record<DeckStatus, { label: string; className: string }> = {
  active: { label: "Ativo", className: "border-primary/40 text-primary" },
  maintenance: { label: "Manutenção", className: "border-border text-muted-foreground" },
  completed: { label: "Concluído", className: "border-border text-muted-foreground" },
  paused: { label: "Pausado", className: "border-border text-muted-foreground" },
  archived: { label: "Arquivado", className: "border-border text-muted-foreground" },
};

export function deckStatusLabel(status: DeckStatus): string {
  return STATUS_META[status].label;
}

export function DeckStatusBadge({ status }: { status: DeckStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        {status === "active" ? "●" : "○"}
      </span>
      {meta.label}
    </span>
  );
}
