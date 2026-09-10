import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "L2L — Local File Converter",
  description:
    "Batch-convert files locally. Network access is not required for conversions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.png" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; form-action 'none'"
        />
      </head>
      <body className="min-h-screen bg-[#070b10] text-slate-100 antialiased selection:bg-[#69dfcb]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
