import { NextResponse, type NextRequest } from "next/server";

// Next 16: proxy.ts substitui middleware.ts. Checagem barata de presença de
// cookie; a validação REAL da sessão acontece nos Server Components via auth().
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth");
  const hasSessionCookie =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!isPublic && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Exclui assets de PWA (manifest e service worker) além do estático do Next,
  // pra que sejam servidos sem passar pela checagem de sessão (senão redirecionam
  // pra /login e o navegador não consegue instalar o app nem registrar o SW).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.png$).*)",
  ],
};
