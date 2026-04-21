"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Link from "next/link";
import { Sparkles, Download, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { api, streamChat } from "@/lib/api";
import type { Message as MessageType, Source, SSEEvent } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { SuggestionChips } from "@/components/suggestion-chips";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Export chat as Markdown ── */
function exportChatAsMarkdown(messages: MessageType[], sessionTitle?: string) {
  let md = `# ${sessionTitle || "Chat Export"}\n\n`;
  md += `Exported from DevGuide on ${new Date().toLocaleDateString()}\n\n---\n\n`;

  for (const msg of messages) {
    if (msg.role === "user") {
      md += `**You:** ${msg.content}\n\n`;
    } else {
      md += `**DevGuide:** ${msg.content}\n\n`;
      if (msg.sources?.length) {
        md += `> Sources: ${msg.sources.map((s) => `${s.file_name} > ${s.heading_path}`).join(", ")}\n\n`;
      }
    }
    md += "---\n\n";
  }

  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sessionTitle || "chat"}-export.md`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ChatInterfaceProps {
  sessionId: string;
}

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const isStreaming = useAppStore((s) => s.isStreaming);
  const setIsStreaming = useAppStore((s) => s.setIsStreaming);
  const setStreamId = useAppStore((s) => s.setStreamId);

  const [pendingMessage, setPendingMessage] = useState("");
  const [pendingSources, setPendingSources] = useState<Source[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  /* ── Feature 13: Streaming markdown buffer ── */
  // Token buffer refs removed — direct flushSync per token works better

  /* ── Feature 14: Scroll to bottom button ── */
  const handleScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollBtn(!atBottom);
  }, []);

  /* ── Feature 15: Confirm before leaving during streaming ── */
  useEffect(() => {
    if (!isStreaming) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isStreaming]);

  const messagesQuery = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => api.getSessionMessages(sessionId),
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions(),
  });
  const sessionTitle = sessionsQuery.data?.find((s) => s.id === sessionId)?.title ?? undefined;

  const docsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
  });

  const hasDocs = (docsQuery.data ?? []).length > 0;

  const starterQuery = useQuery({
    queryKey: ["starter-questions"],
    queryFn: api.starterQuestions,
    enabled: hasDocs, // Only fetch when docs exist
  });

  const messages = messagesQuery.data ?? [];
  const messageCount = messages.length;

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, pendingMessage, followups, isSearching]);

  const handleSend = useCallback(
    async (message: string) => {
      setIsStreaming(true);
      setFollowups([]);
      setPendingMessage("");
      setPendingSources([]);
      setIsSearching(false);
      setError(null);

      // Optimistically add the user message to the query cache
      queryClient.setQueryData(
        ["messages", sessionId],
        (old: typeof messages | undefined) => [
          ...(old ?? []),
          {
            id: `pending-${Date.now()}`,
            role: "user" as const,
            content: message,
            sources: null,
            created_at: new Date().toISOString(),
          },
        ]
      );

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          sessionId,
          message,
          (event: SSEEvent) => {
            switch (event.type) {
              case "stream_start":
                flushSync(() => setStreamId(event.data.stream_id));
                break;
              case "search_start":
                flushSync(() => setIsSearching(true));
                break;
              case "sources":
                flushSync(() => {
                  setIsSearching(false);
                  setPendingSources(event.data);
                });
                break;
              case "token":
                // Flush each token immediately — no buffering
                flushSync(() => {
                  setPendingMessage((prev) => prev + event.data);
                });
                break;
              case "done":
                flushSync(() => {
                  setIsStreaming(false);
                  setStreamId(null);
                  setFollowups(event.data.followups ?? []);
                  setPendingMessage("");
                  setPendingSources([]);
                  setIsSearching(false);
                });
                queryClient.invalidateQueries({
                  queryKey: ["messages", sessionId],
                });
                queryClient.invalidateQueries({ queryKey: ["sessions"] });
                break;
              case "stopped":
                flushSync(() => {
                  setIsStreaming(false);
                  setStreamId(null);
                  setPendingMessage("");
                  setPendingSources([]);
                  setIsSearching(false);
                });
                queryClient.invalidateQueries({
                  queryKey: ["messages", sessionId],
                });
                break;
              case "error":
                flushSync(() => {
                  setIsStreaming(false);
                  setStreamId(null);
                  setIsSearching(false);
                  setError(event.data.message);
                  setPendingMessage("");
                  setPendingSources([]);
                });
                break;
            }
          },
          controller.signal
        );
      } catch (err) {
        // AbortError is expected when user stops the stream
        if (err instanceof DOMException && err.name === "AbortError") {
          flushSync(() => {
            setIsStreaming(false);
            setStreamId(null);
            setIsSearching(false);
            // pendingMessage stays visible as partial response
          });
          // Wait a moment for backend to save partial response, then refresh
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["sessions"] });
            // Clear pending after DB has the message
            setPendingMessage("");
            setPendingSources([]);
          }, 1500);
          return;
        }
        flushSync(() => {
          setIsStreaming(false);
          setStreamId(null);
          setIsSearching(false);
          setError(
            err instanceof Error ? err.message : "An unknown error occurred"
          );
        });
      }
    },
    [sessionId, queryClient, setIsStreaming, setStreamId]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    api.stopStream(sessionId).catch(console.error);
  }, [sessionId]);

  const handleChipSelect = useCallback(
    (question: string) => {
      handleSend(question);
    },
    [handleSend]
  );

  const hasMessages = messages.length > 0;
  const starterQuestions = starterQuery.data?.questions ?? [];
  const showStarters = !hasMessages && !isStreaming && hasDocs && starterQuestions.length > 0;
  const showFollowups = hasMessages && !isStreaming && followups.length > 0;

  const handleExport = useCallback(() => {
    exportChatAsMarkdown(messages, sessionTitle);
    toast.success("Chat exported as Markdown");
  }, [messages, sessionTitle]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages area */}
      <div ref={messagesRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {/* Export button — visible when there are messages */}
        {hasMessages && !isStreaming && (
          <button
            type="button"
            onClick={handleExport}
            title="Export chat as Markdown"
            className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 shadow-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Download className="size-3.5" />
            Export
          </button>
        )}
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {/* Empty state */}
          {!hasMessages && !isStreaming && (
            <div className="flex flex-col items-center gap-5 py-20 text-center">
              <Avatar className="size-16">
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <Sparkles className="size-8" />
                </AvatarFallback>
              </Avatar>
              {hasDocs ? (
                <div>
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                    Ready to help
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    I&apos;ve indexed {docsQuery.data?.length || 0} document{(docsQuery.data?.length || 0) !== 1 ? "s" : ""} about your project. Ask me anything!
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                    No documents indexed yet
                  </h2>
                  <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
                    Upload your Markdown docs first to get started.
                  </p>
                  <Button render={<Link href="/upload" />} className="mt-4">
                    Upload Docs
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Loading skeletons */}
          {messagesQuery.isLoading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Starter suggestions */}
          {showStarters && (
            <div className="flex justify-center">
              <SuggestionChips
                questions={starterQuestions}
                onSelect={handleChipSelect}
                disabled={isStreaming}
              />
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              createdAt={msg.created_at}
            />
          ))}

          {/* Searching / thinking indicator — show when streaming but no text yet */}
          {isStreaming && !pendingMessage && (
            <div className="flex items-start gap-3 py-2">
              <Avatar className="size-7 mt-0.5 shrink-0">
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <Sparkles className="size-3.5" />
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {isSearching ? "Searching documentation..." : "Generating response..."}
                </span>
                <div className="flex items-center gap-1">
                  <span className="animate-bounce-dot-1 inline-block size-1.5 rounded-full bg-blue-400" />
                  <span className="animate-bounce-dot-2 inline-block size-1.5 rounded-full bg-blue-400" />
                  <span className="animate-bounce-dot-3 inline-block size-1.5 rounded-full bg-blue-400" />
                </div>
              </div>
            </div>
          )}

          {/* Streaming or stopped-partial assistant message */}
          {pendingMessage && (
            <ChatMessage
              role="assistant"
              content={pendingMessage}
              sources={pendingSources.length > 0 ? pendingSources : undefined}
              isStreaming={isStreaming}
            />
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-300/50 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Follow-up suggestions */}
          {showFollowups && (
            <div className="ml-10 flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-300 dark:text-zinc-600">
                Follow-up questions
              </span>
              <SuggestionChips
                questions={followups}
                onSelect={handleChipSelect}
                disabled={isStreaming}
              />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            type="button"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-zinc-800 dark:bg-zinc-200 px-3 py-1.5 text-xs text-zinc-100 dark:text-zinc-900 shadow-lg transition-all hover:bg-zinc-700 dark:hover:bg-zinc-300"
          >
            <ArrowDown className="size-3" />
            Scroll to bottom
          </button>
        )}
      </div>

      {/* Input area — always pinned at bottom */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-6 py-3">
        <div className="mx-auto max-w-2xl">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
          />
          <p className="mt-1.5 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
