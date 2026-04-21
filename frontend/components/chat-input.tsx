"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
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
    const maxHeight = 120;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "36px";
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
    <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 shadow-sm transition-all duration-200 focus-within:border-zinc-400 dark:focus-within:border-zinc-600 focus-within:ring-2 focus-within:ring-blue-500/20">
      <textarea
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
        className="flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-normal text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ height: "36px", maxHeight: "120px" }}
      />

      <div className="flex shrink-0 items-center pb-0.5">
        {isStreaming ? (
          <Button
            onClick={onStop}
            size="icon"
            className="size-8 rounded-full bg-red-600 text-white shadow-sm transition-all duration-150 hover:bg-red-500 active:scale-95"
            aria-label="Stop generating"
          >
            <Square className="size-3.5" fill="currentColor" />
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            size="icon"
            className="size-8 rounded-full bg-blue-600 text-white shadow-sm transition-all duration-150 hover:bg-blue-500 active:scale-95 disabled:bg-zinc-200 dark:disabled:bg-zinc-700 disabled:text-zinc-400 dark:disabled:text-zinc-500 disabled:shadow-none"
            aria-label="Send message"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </Button>
        )}
      </div>
    </div>
  );
}
