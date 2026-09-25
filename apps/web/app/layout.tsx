import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Playwrite_VN } from "next/font/google";
import "./globals.css";

// Be Vietnam Pro was drawn for Vietnamese diacritics; it carries the whole interface.
const sans = Be_Vietnam_Pro({ variable: "--font-sans-ui", subsets: ["latin", "latin-ext", "vietnamese"], weight: ["400", "500", "600", "700"] });
// TypeTogether's model of Vietnamese school handwriting — used only for the date line and the wordmark.
const hand = Playwrite_VN({ variable: "--font-hand-face", weight: ["300"], fallback: ["cursive"] });

export const metadata: Metadata = {
  title: { default: "gnouht hub", template: "%s | gnouht hub" },
  description: "Courses, deadlines, projects and study groups in one place.",
  // A private workspace: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#18211d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${hand.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans text-[15px]">{children}</body>
    </html>
  );
}
