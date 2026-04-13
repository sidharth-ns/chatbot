"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    // Max 5 lines (~120px at ~24px per line)
    const maxHeight = 120;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue("");
    // Reset height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }, [value, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="relative flex items-end gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 shadow-lg transition-all duration-200 focus-within:border-zinc-600 focus-within:ring-2 focus-within:ring-blue-500/20">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          isStreaming
            ? "Generating response..."
            : "Ask about the project documentation..."
        }
        disabled={isStreaming || disabled}
        rows={1}
        className="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 shadow-none outline-none ring-0 min-h-0 p-0 focus-visible:border-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ height: "24px" }}
      />

      {isStreaming ? (
        <Button
          onClick={onStop}
          size="icon"
          className="size-8 shrink-0 rounded-full bg-red-600 text-white shadow-sm transition-all duration-150 hover:bg-red-500 active:scale-95"
          aria-label="Stop generating"
        >
          <Square className="size-3.5" fill="currentColor" />
        </Button>
      ) : (
        <Button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          size="icon"
          className="size-8 shrink-0 rounded-full bg-blue-600 text-white shadow-sm transition-all duration-150 hover:bg-blue-500 active:scale-95 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none"
          aria-label="Send message"
        >
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </Button>
      )}
    </div>
  );
}
