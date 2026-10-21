import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KH Delivery",
  description: "Track sales orders and deliveries",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "KH Delivery", statusBarStyle: "default" },
  icons: { icon: "/icons/favicon.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0041c2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React loads. */}
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
