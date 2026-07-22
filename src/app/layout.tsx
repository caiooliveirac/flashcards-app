import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { BRAND } from "@/lib/brand";
import { AssistantMount } from "@/components/ai-assistant/assistant-mount";
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
      </body>
    </html>
  );
}
