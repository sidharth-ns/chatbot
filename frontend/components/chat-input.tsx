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
    // Max 4 lines (~96px at ~24px per line)
    const maxHeight = 96;
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
    <div className="flex items-end gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
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
        className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ height: "24px" }}
      />

      {isStreaming ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onStop}
          className="shrink-0 text-zinc-400 hover:text-zinc-100"
          aria-label="Stop generating"
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="shrink-0 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
          aria-label="Send message"
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </div>
  );
}
