"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  MessageSquare,
  Plus,
  Upload,
  Bot,
  Trash2,
  ChevronDown,
} from "lucide-react";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

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
  const params = useParams();
  const queryClient = useQueryClient();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const activeSessionId = params?.sessionId as string | undefined;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // If we deleted the active session, navigate to home
      if (activeSessionId === deletedId) {
        router.push("/");
      }
    },
  });

  async function handleNewChat() {
    try {
      const session = await api.createSession();
      router.push(`/chat/${session.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }

  function handleDeleteClick(e: React.MouseEvent, sessionId: string) {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDeleteId(sessionId);
  }

  function handleConfirmDelete() {
    if (confirmDeleteId) {
      deleteMutation.mutate(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }

  if (!sidebarOpen) return null;

  return (
    <aside className="flex h-screen w-[280px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Logo / Title */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600/15">
          <Bot className="size-5 text-blue-400" />
        </div>
        <span className="text-lg font-semibold text-zinc-100">OnboardBot</span>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Navigation */}
      <div className="flex flex-col gap-1 px-3 py-3">
        <Link href="/upload">
          <Button variant="ghost" className="w-full justify-start gap-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50">
            <Upload className="size-4" />
            Upload Docs
          </Button>
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
          onClick={handleNewChat}
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Documents Section */}
      <Collapsible defaultOpen className="flex flex-col px-3 pt-2 pb-1">
        <CollapsibleTrigger
          className="flex items-center justify-between rounded-md px-1 py-1 transition-colors hover:bg-zinc-800/30"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Documents
          </span>
          <ChevronDown className="size-3 text-zinc-600 transition-transform data-[panel-open]:rotate-0 data-[panel-closed]:rotate-[-90deg]" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea className="mt-1 max-h-[200px] overflow-auto">
            {documents && documents.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText className="size-3.5 shrink-0 text-zinc-600" />
                      <span className="truncate text-xs">{doc.filename}</span>
                    </div>
                    <Badge variant="secondary" className="ml-2 shrink-0 bg-zinc-800 text-[10px] text-zinc-500">
                      {doc.node_count}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-2 py-2 text-xs text-zinc-600">No documents indexed</p>
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-zinc-800" />

      {/* Sessions Section */}
      <Collapsible defaultOpen className="flex min-h-0 flex-1 flex-col px-3 pt-2 pb-3">
        <div className="flex items-center justify-between px-1">
          <CollapsibleTrigger
            className="flex items-center gap-1 rounded-md py-1 transition-colors hover:bg-zinc-800/30"
          >
            <ChevronDown className="size-3 text-zinc-600 transition-transform data-[panel-open]:rotate-0 data-[panel-closed]:rotate-[-90deg]" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Chat Sessions
            </span>
          </CollapsibleTrigger>
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
            title="New Chat"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <CollapsibleContent>
          <ScrollArea className="mt-1 flex-1 overflow-auto">
            {sessions && sessions.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {sessions.map((session) => {
                  const isActive = activeSessionId === session.id;
                  return (
                    <Link
                      key={session.id}
                      href={`/chat/${session.id}`}
                      className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "border-l-2 border-blue-500 bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageSquare className={`size-3.5 shrink-0 ${isActive ? "text-blue-400" : "text-zinc-600"}`} />
                        <span className="truncate text-xs">
                          {truncate(session.title || "Untitled", 24)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[10px] text-zinc-600 group-hover:hidden">
                          {relativeTime(session.updated_at)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(e, session.id)}
                          className="hidden rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-700 hover:text-red-400 group-hover:block"
                          title="Delete chat"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-2 text-xs text-zinc-600">No sessions yet</p>
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete chat session?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete this chat and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
