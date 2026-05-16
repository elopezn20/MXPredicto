import type { ReactNode } from "react";

// Root layout is a pass-through; app/[locale]/layout.tsx provides <html> and <body>
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return children;
}
