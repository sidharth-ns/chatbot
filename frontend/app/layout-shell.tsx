"use client";

import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Sidebar toggle button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-3 top-3 z-10 text-zinc-400 hover:text-zinc-100"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <Menu className="size-5" />
        </Button>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
