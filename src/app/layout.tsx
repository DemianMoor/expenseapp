import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Colibrix Expense Categorizer",
  description: "Upload a Colibrix CSV, categorize, and sync to Google Sheets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
