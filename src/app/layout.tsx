import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { TRPCProvider } from "@/trpc/client";

import "./globals.css";

export const metadata: Metadata = {
  title: "ClipMarket",
  description: "Paid clipping campaigns for brands and creators",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <TRPCProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <AppHeader />
          <main id="main" className="mx-auto max-w-6xl px-4 py-8">
            {children}
          </main>
        </TRPCProvider>
      </body>
    </html>
  );
}
