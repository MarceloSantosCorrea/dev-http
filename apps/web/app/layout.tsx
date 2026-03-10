import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk, Geist } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const heading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "DevHttp",
  description: "Cliente HTTP colaborativo para web e desktop.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var stored=localStorage.getItem('devhttp-theme')||'system';var resolved=stored==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):stored;document.documentElement.classList.remove('dark','light');document.documentElement.classList.add(resolved);})();`,
          }}
        />
      </head>
      <body className={`${heading.variable} ${mono.variable}`}>{children}<Toaster /></body>
    </html>
  );
}
