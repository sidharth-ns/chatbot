"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  MessageCircle,
  Plus,
  Upload,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Search,
  X,
} from "lucide-react";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { ThemeToggle } from "@/components/theme-toggle";
import { DocPreviewSheet } from "@/components/doc-preview-sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

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

export function AppSidebar() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const activeSessionId = params?.sessionId as string | undefined;
  const { toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");

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
      toast.success("Chat deleted");
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

  // Filter sessions by search query
  const filteredSessions = sessions?.filter((session) =>
    (session.title || "Untitled")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  // Auto-close sidebar on mobile after navigation
  function closeSidebarOnMobile() {
    if (isMobile) {
      toggleSidebar();
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

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo / Title */}
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar className="size-8">
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <Sparkles className="size-4" />
            </AvatarFallback>
          </Avatar>
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            DevGuide
          </span>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {/* Navigation group */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/upload" />}
                tooltip="Upload Docs"
                onClick={closeSidebarOnMobile}
              >
                <Upload className="size-4" />
                <span>Upload Docs</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  handleNewChat();
                  closeSidebarOnMobile();
                }}
                tooltip="New Chat"
              >
                <Plus className="size-4" />
                <span>New Chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Chats group */}
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup className="flex-1">
            <SidebarGroupLabel render={<CollapsibleTrigger />} className="cursor-pointer">
              <MessageCircle className="size-4" />
              Chats
            </SidebarGroupLabel>
            <SidebarGroupAction title="New Chat" onClick={handleNewChat}>
              <Plus className="size-4" />
            </SidebarGroupAction>
            <CollapsibleContent>
              <SidebarGroupContent>
                {/* Search input for chats */}
                {sessions && sessions.length > 1 && (
                  <div className="relative px-2 pb-1.5">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="Search chats..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-7 pl-7 pr-7 text-xs bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {!sessions && (
                  <div className="space-y-1 px-2">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-7 w-full rounded" />)}
                  </div>
                )}
                <SidebarMenu>
                  {filteredSessions && filteredSessions.length > 0 ? (
                    filteredSessions.map((session) => {
                      const isActive = activeSessionId === session.id;
                      return (
                        <SidebarMenuItem key={session.id}>
                          <SidebarMenuButton
                            render={<Link href={`/chat/${session.id}`} />}
                            isActive={isActive}
                            tooltip={`${session.title || "Untitled"} · ${relativeTime(session.updated_at)}`}
                            onClick={closeSidebarOnMobile}
                          >
                            <MessageCircle
                              className={`size-4 shrink-0 ${
                                isActive
                                  ? "text-blue-400"
                                  : "text-zinc-600 dark:text-zinc-400"
                              }`}
                            />
                            <span className="truncate">
                              {truncate(session.title || "Untitled", 24)}
                            </span>
                          </SidebarMenuButton>
                          {/* Action buttons — show on hover */}
                          <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover/menu-item:flex">
                            <button
                              type="button"
                              title="Copy link"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const url = `${window.location.origin}/chat/${session.id}`;
                                try {
                                  navigator.clipboard.writeText(url);
                                } catch {
                                  // Fallback for non-HTTPS
                                  const textarea = document.createElement("textarea");
                                  textarea.value = url;
                                  document.body.appendChild(textarea);
                                  textarea.select();
                                  document.execCommand("copy");
                                  document.body.removeChild(textarea);
                                }
                                setCopiedId(session.id);
                                toast.success("Link copied to clipboard");
                                setTimeout(() => setCopiedId(null), 1500);
                              }}
                              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                              {copiedId === session.id ? (
                                <Check className="size-3 text-green-500" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Delete chat"
                              onClick={(e) => handleDeleteClick(e, session.id)}
                              className="rounded p-1 text-zinc-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </SidebarMenuItem>
                      );
                    })
                  ) : filteredSessions && searchQuery ? (
                    <p className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      No matching chats
                    </p>
                  ) : sessions ? (
                    <p className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      No sessions yet
                    </p>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <SidebarSeparator />

        {/* Documents group */}
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel render={<CollapsibleTrigger />} className="cursor-pointer">
              <FileText className="size-4" />
              Documents
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                {!documents && (
                  <div className="space-y-1 px-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full rounded" />)}
                  </div>
                )}
                <SidebarMenu>
                  {documents && documents.length > 0 ? (
                    documents.map((doc) => (
                      <SidebarMenuItem key={doc.id}>
                        <SidebarMenuButton
                          className="cursor-pointer"
                          onClick={() => {
                            setPreviewDocId(doc.id);
                            setPreviewFilename(doc.filename);
                          }}
                        >
                          <FileText className="size-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
                          <span className="truncate">{doc.filename}</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction className="pointer-events-none">
                          <Badge
                            variant="secondary"
                            className="text-[10px] text-zinc-600 dark:text-zinc-400"
                          >
                            {doc.node_count}
                          </Badge>
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    ))
                  ) : documents ? (
                    <p className="px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      No documents indexed
                    </p>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>

      {/* Footer with theme toggle */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Document Preview Sheet */}
      <DocPreviewSheet
        docId={previewDocId}
        filename={previewFilename}
        onClose={() => setPreviewDocId(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-900 dark:text-zinc-100">
              Delete chat session?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500 dark:text-zinc-400">
              This will permanently delete this chat and all its messages. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100">
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
    </div>
  );
}
