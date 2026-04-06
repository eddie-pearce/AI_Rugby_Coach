import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { ClipQueueProvider } from "@/context/ClipQueueContext";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
    <html lang="en" className={`${geist.variable} h-full`}>
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
