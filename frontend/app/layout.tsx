import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { ClipQueueProvider } from "@/context/ClipQueueContext";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "BreakdownAI",
  description: "Analysis with AI, delivered in plain english",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="flex flex-col lg:flex-row min-h-screen antialiased">
        <ClipQueueProvider>
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            {children}
          </div>
        </ClipQueueProvider>
      </body>
    </html>
  );
}
