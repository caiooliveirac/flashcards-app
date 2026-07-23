import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { MobileMenu } from "@/components/mobile-menu";

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
 * Header enxuto do handoff: marca + navegação (inclui link "Assistente" da IA)
 * + área do usuário à direita (passada como children: nome, sair, admin).
 * Telas de sessão de revisão NÃO usam este header (chrome mínimo próprio).
 */
export function SiteHeader({
  children,
  showNav = true,
  isAdmin = false,
}: {
  children?: React.ReactNode;
  showNav?: boolean;
  /** Inclui o link "Admin" no menu mobile. */
  isAdmin?: boolean;
}) {
  return (
    <header className="border-b-2 border-divider">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3.5">
        <Link href="/" data-ms-tilt="6" data-ms-shadow className="shrink-0">
          <BrandMark />
        </Link>
        {showNav ? (
          <nav className="hidden items-center gap-5 text-sm font-semibold sm:flex">
            <Link href="/" className="hover:text-primary-text">
              Baralhos
            </Link>
            <Link href="/painel" className="hover:text-primary-text">
              Painel
            </Link>
            <Link
              href="/assistente"
              className="hover:text-primary-text"
              title="Assistente de criação de cards com IA"
            >
              ✳ Assistente
            </Link>
          </nav>
        ) : null}
        <div className="ml-auto flex items-center gap-4 text-sm">
          {children}
          {showNav ? <MobileMenu isAdmin={isAdmin} /> : null}
        </div>
      </div>
    </header>
  );
}
