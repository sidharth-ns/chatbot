"use client";

import {
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppSidebar } from "@/components/sidebar";

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { open, toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Mobile backdrop overlay */}
      {open && isMobile && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar — resizable on desktop, fixed overlay on mobile */}
      {open && (
        <div
          className={`relative flex shrink-0 border-r border-zinc-200 dark:border-zinc-800 ${
            isMobile
              ? "fixed inset-y-0 left-0 z-30"
              : "z-auto"
          }`}
          style={{ width: 280 }}
        >
          <div className="flex-1 overflow-hidden">
            <AppSidebar />
          </div>
          {/* Drag handle — desktop only */}
          {!isMobile && (
            <div
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500 active:bg-blue-600"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const sidebar = e.currentTarget.parentElement!;
                const startWidth = sidebar.offsetWidth;

                const onMouseMove = (ev: MouseEvent) => {
                  const newWidth = Math.max(200, Math.min(400, startWidth + (ev.clientX - startX)));
                  sidebar.style.width = `${newWidth}px`;
                };

                const onMouseUp = () => {
                  document.removeEventListener("mousemove", onMouseMove);
                  document.removeEventListener("mouseup", onMouseUp);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };

                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
              }}
            />
          )}
        </div>
      )}

      {/* Main content — always fills remaining space */}
      <div className="flex w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 px-4 backdrop-blur-sm">
          <SidebarTrigger />
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <LayoutContent>{children}</LayoutContent>
    </SidebarProvider>
  );
}
