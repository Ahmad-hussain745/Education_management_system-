import { Inter } from "next/font/google";
import "./globals.css";

// One typeface for the whole app — set once here via next/font (self-hosted,
// no external request at runtime) and wired into Tailwind's default sans
// stack in tailwind.config.js, so every existing `font-sans`/unstyled text
// element across all ~150 pages picks it up automatically without touching
// each page individually.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = {
  title: "MSA Academy Management System",
  description: "Fees · Finance · Attendance · Salary · Syllabus",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MSA Academy",
  },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
