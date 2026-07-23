import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { BRAND } from "@/lib/brand";
import { AssistantMount } from "@/components/ai-assistant/assistant-mount";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { MotionRoot } from "@/lib/motion/motion-root";
import { TrailLayer } from "@/lib/motion/trail-layer";
import "katex/dist/katex.min.css";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BRAND}.`,
  description: "Flashcards inteligentes com revisão espaçada",
  applicationName: `${BRAND}.`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: `${BRAND}.`,
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

// theme_color muda conforme o tema (claro/escuro) do sistema.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#181615" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={archivo.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <AssistantMount />
        <MotionRoot />
        <TrailLayer />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
