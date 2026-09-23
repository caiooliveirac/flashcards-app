import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["pg"],
  // Só afeta `next dev`: permite acessar o LAB pelo hostname do túnel Cloudflare
  allowedDevOrigins: ["lab-flashcards.mnrs.com.br"],
};

export default nextConfig;
