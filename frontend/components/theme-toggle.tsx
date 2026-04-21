"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import {
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <SidebarMenuButton
      onClick={() => setTheme(isDark ? "light" : "dark")}
      tooltip={isDark ? "Light Mode" : "Dark Mode"}
    >
      {isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
      <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
    </SidebarMenuButton>
  );
}
