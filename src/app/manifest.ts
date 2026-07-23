import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// PWA: torna o app instalável (Chrome/Android "Instalar", iOS "Adicionar à Tela").
// Cores derivadas dos tokens do design system (globals.css).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND}. — Flashcards inteligentes`,
    short_name: `${BRAND}.`,
    description: "Flashcards inteligentes com revisão espaçada",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    dir: "ltr",
    orientation: "portrait",
    background_color: "#181615",
    theme_color: "#181615",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
