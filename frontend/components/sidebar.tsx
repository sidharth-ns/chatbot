"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  MessageSquare,
  Plus,
  Upload,
  Bot,
} from "lucide-react";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function Sidebar() {
  const router = useRouter();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  const { data: documents } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.listDocuments(),
    refetchInterval: 30_000,
  });

  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions(),
    refetchInterval: 10_000,
  });

  async function handleNewChat() {
    try {
      const session = await api.createSession();
      router.push(`/chat/${session.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }

  if (!sidebarOpen) return null;

  return (
    <aside className="flex h-screen w-[280px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Logo / Title */}
      <div className="flex items-center gap-2 px-4 py-5">
        <Bot className="size-6 text-zinc-100" />
        <span className="text-lg font-semibold text-zinc-100">OnboardBot</span>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Navigation */}
      <div className="flex flex-col gap-1 px-3 py-3">
        <Link href="/upload">
          <Button variant="ghost" className="w-full justify-start gap-2 text-zinc-300 hover:text-zinc-100">
            <Upload className="size-4" />
            Upload Docs
          </Button>
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-zinc-300 hover:text-zinc-100"
          onClick={handleNewChat}
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Documents Section */}
      <div className="flex flex-col px-3 pt-3 pb-1">
        <span className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Documents
        </span>
        <ScrollArea className="max-h-[200px] overflow-auto">
          {documents && documents.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-300"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="size-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate">{doc.filename}</span>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0 bg-zinc-800 text-zinc-400">
                    {doc.node_count}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-xs text-zinc-500">No documents indexed</p>
          )}
        </ScrollArea>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Sessions Section */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
        <span className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Chat Sessions
        </span>
        <ScrollArea className="flex-1 overflow-auto">
          {sessions && sessions.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/chat/${session.id}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MessageSquare className="size-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate">
                      {truncate(session.title || "Untitled", 30)}
                    </span>
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-zinc-600">
                    {relativeTime(session.updated_at)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-xs text-zinc-500">No sessions yet</p>
          )}
        </ScrollArea>
      </div>
    </aside>
  );
}
