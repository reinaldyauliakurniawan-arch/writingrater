import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/config";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Latihan menilai IELTS Writing Task 1 Academic dan Task 2 dengan AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${montserrat.variable} ${montserrat.className}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
