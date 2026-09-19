import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "NicheScout — Find products worth selling",
  description:
    "Explore supplier costs, market signals, and shipping before you commit. What would you like to sell? Describe your niche, review opportunities, create a listing.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
