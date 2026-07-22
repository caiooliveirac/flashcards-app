/**
 * Morphing de ícones (handoff §3 · 4d).
 *
 * As MESMAS barras se movem — nunca trocamos um glifo por outro. Por isso o
 * ícone é feito de retângulos (raio zero, coerente com o design system) e o
 * estado vive em `data-ms-done` / no `aria-expanded` do botão que o contém.
 *
 * Puramente decorativo: `aria-hidden`, o rótulo acessível fica no botão.
 */
export function IconMorph({
  variant,
  done = false,
  className = "",
}: {
  /** `menu`: ⋯ → × (segue o aria-expanded do botão pai) · `plus`: + → ✓ */
  variant: "menu" | "plus";
  /** Só para `plus`: liga o estado ✓. */
  done?: boolean;
  className?: string;
}) {
  const bars = variant === "menu" ? 3 : 2;
  return (
    <span
      aria-hidden="true"
      data-ms-morph={variant}
      {...(done ? { "data-ms-done": "" } : {})}
      className={`ms-morph ${className}`}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
