import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "google-reviews-download",
  description:
    "Export a Google business's reviews as CSV, JSON, or XLSX. Paste the place, get the file.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
