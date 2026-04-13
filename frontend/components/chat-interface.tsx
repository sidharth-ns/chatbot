"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";

import { api, streamChat } from "@/lib/api";
import type { Source, SSEEvent } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { SuggestionChips } from "@/components/suggestion-chips";

interface ChatInterfaceProps {
  sessionId: string;
}

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isStreaming = useAppStore((s) => s.isStreaming);
  const setIsStreaming = useAppStore((s) => s.setIsStreaming);
  const setStreamId = useAppStore((s) => s.setStreamId);

  const [pendingMessage, setPendingMessage] = useState("");
  const [pendingSources, setPendingSources] = useState<Source[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesQuery = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => api.getSessionMessages(sessionId),
  });

  const starterQuery = useQuery({
    queryKey: ["starter-questions"],
    queryFn: api.starterQuestions,
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
                setStreamId(event.data.stream_id);
                break;
              case "search_start":
                setIsSearching(true);
                break;
              case "sources":
                setIsSearching(false);
                setPendingSources(event.data);
                break;
              case "token":
                setPendingMessage((prev) => prev + event.data);
                break;
              case "done":
                setIsStreaming(false);
                setStreamId(null);
                setFollowups(event.data.followups ?? []);
                setPendingMessage("");
                setPendingSources([]);
                setIsSearching(false);
                queryClient.invalidateQueries({
                  queryKey: ["messages", sessionId],
                });
                queryClient.invalidateQueries({ queryKey: ["sessions"] });
                break;
              case "stopped":
                setIsStreaming(false);
                setStreamId(null);
                setPendingMessage("");
                setPendingSources([]);
                setIsSearching(false);
                queryClient.invalidateQueries({
                  queryKey: ["messages", sessionId],
                });
                break;
              case "error":
                setIsStreaming(false);
                setStreamId(null);
                setIsSearching(false);
                setError(event.data.message);
                setPendingMessage("");
                setPendingSources([]);
                break;
            }
          },
          controller.signal
        );
      } catch (err) {
        // AbortError is expected when user stops the stream
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setIsStreaming(false);
        setStreamId(null);
        setIsSearching(false);
        setError(
          err instanceof Error ? err.message : "An unknown error occurred"
        );
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
  const showStarters = !hasMessages && !isStreaming && starterQuestions.length > 0;
  const showFollowups = hasMessages && !isStreaming && followups.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {/* Empty state */}
          {!hasMessages && !isStreaming && (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="rounded-full bg-zinc-800 p-4">
                <Search className="size-6 text-zinc-400" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-zinc-200">
                  Ask about your documentation
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Get instant, source-backed answers from your indexed docs.
                </p>
              </div>
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
            />
          ))}

          {/* Searching indicator */}
          {isSearching && (
            <div className="flex items-center gap-2 px-1 text-sm text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" />
              Searching documentation...
            </div>
          )}

          {/* Streaming assistant message */}
          {isStreaming && pendingMessage && (
            <ChatMessage
              role="assistant"
              content={pendingMessage}
              sources={pendingSources.length > 0 ? pendingSources : undefined}
              isStreaming
            />
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Follow-up suggestions */}
          {showFollowups && (
            <SuggestionChips
              questions={followups}
              onSelect={handleChipSelect}
              disabled={isStreaming}
            />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-800 px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
