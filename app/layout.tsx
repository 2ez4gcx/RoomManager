import type { Metadata } from "next";
import { Be_Vietnam_Pro, DM_Sans } from "next/font/google";
import "./globals.css";

const display = Be_Vietnam_Pro({
  variable: "--font-display",
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
});

const body = DM_Sans({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "RoomManager — Quản lý nhà trọ",
  description: "Quản lý phòng, đơn thu, phụ thu và đặt phòng online cho nhà trọ.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "RoomManager",
    description: "Quản lý nhà trọ gọn trong một màn hình",
    images: [{ url: "/og.png", width: 1728, height: 896, alt: "RoomManager" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
