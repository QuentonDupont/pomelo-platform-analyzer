import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Pomelo Bounce & Release Impact",
  description: "Bounce rate by section, web vs app, and production release impact",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
