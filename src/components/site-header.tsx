import Link from "next/link";
import { BRAND } from "@/lib/brand";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`font-extrabold tracking-tight text-[15px] ${className ?? ""}`}
    >
      {BRAND}
      <span className="text-primary">.</span>
    </span>
  );
}

/**
 * Header enxuto do handoff: marca + navegação + chip "Assistente — em breve"
 * (inativo) + área do usuário à direita (passada como children: nome, sair, admin).
 * Telas de sessão de revisão NÃO usam este header (chrome mínimo próprio).
 */
export function SiteHeader({
  children,
  showNav = true,
}: {
  children?: React.ReactNode;
  showNav?: boolean;
}) {
  return (
    <header className="border-b-2 border-divider">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="shrink-0">
          <BrandMark />
        </Link>
        {showNav ? (
          <nav className="hidden items-center gap-5 text-sm font-semibold sm:flex">
            <Link href="/" className="hover:text-primary-text">
              Baralhos
            </Link>
            <span
              className="cursor-default text-muted-foreground"
              title="Assistente de criação com IA — em breve"
            >
              ✳ Assistente — em breve
            </span>
          </nav>
        ) : null}
        <div className="ml-auto flex items-center gap-4 text-sm">{children}</div>
      </div>
    </header>
  );
}
