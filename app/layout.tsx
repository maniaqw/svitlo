import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Світло — графіки відключень",
  description:
    "Офіційні графіки відключень електроенергії. Оберіть область, оператора та чергу.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
