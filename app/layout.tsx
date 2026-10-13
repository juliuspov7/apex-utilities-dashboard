import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apex Utilities Dashboard",
  description: "Utilities actual vs budget for Apex hotels",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
