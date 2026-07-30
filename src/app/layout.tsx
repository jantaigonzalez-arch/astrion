import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evoelution",
  description: "Automatización analítica y cromatografía.",
};

// El <html>/<body> se renderiza en app/[locale]/layout.tsx (depende del idioma).
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
