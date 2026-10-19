import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mi cartera",
  description: "Mi dinero: cuentas, inversiones, gastos y proyección",
  // On the iPhone, when pinned to the home screen it opens full screen
  appleWebApp: { capable: true, title: "Mi cartera", statusBarStyle: "default" },
};

// Browser bar color: the app's background in light and dark mode
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
