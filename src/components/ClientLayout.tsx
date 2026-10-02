"use client";

import { ThemeProvider } from "@/contexts/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";
import IdleTimeout from "@/components/IdleTimeout";
import ForceChangePassword from "@/components/ForceChangePassword";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <ThemeToggle />
      <IdleTimeout />
      <ForceChangePassword />
    </ThemeProvider>
  );
}
