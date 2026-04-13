"use client";

import { useMemo } from "react";
import { Bot, User } from "lucide-react";
import type { Source } from "@/lib/types";
import { SourceCard } from "@/components/source-card";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  isStreaming?: boolean;
}

/**
 * Renders markdown-like content into React elements.
 * Handles code blocks (```), inline code (`), bold (**), and basic paragraphs.
 */
function renderMarkdown(text: string): React.ReactNode[] {
  // Split on fenced code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  const elements: React.ReactNode[] = [];

  parts.forEach((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      // Fenced code block
      const inner = part.slice(3, -3);
      // Remove optional language identifier on first line
      const newlineIdx = inner.indexOf("\n");
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      elements.push(
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-md bg-zinc-900 p-3 text-sm"
        >
          <code className="text-zinc-200">{code}</code>
        </pre>
      );
    } else if (part.trim()) {
      // Regular text — split into paragraphs
      const paragraphs = part.split(/\n\n+/);
      paragraphs.forEach((para, j) => {
        const trimmed = para.trim();
        if (!trimmed) return;

        // Check if this paragraph is a list (lines starting with - or *)
        const lines = trimmed.split("\n");
        const isList = lines.every(
          (line) =>
            /^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line) || !line.trim()
        );

        if (isList) {
          const items = lines.filter((l) => l.trim());
          elements.push(
            <ul key={`${i}-${j}`} className="my-1.5 ml-4 list-disc space-y-0.5">
              {items.map((item, k) => (
                <li key={k} className="text-sm">
                  {renderInline(item.replace(/^\s*[-*]\s/, "").replace(/^\s*\d+\.\s/, ""))}
                </li>
              ))}
            </ul>
          );
        } else {
          elements.push(
            <p key={`${i}-${j}`} className="my-1 text-sm leading-relaxed">
              {renderInline(trimmed.replace(/\n/g, " "))}
            </p>
          );
        }
      });
    }
  });

  return elements;
}

/**
 * Handles inline formatting: bold (**text**) and inline code (`code`).
 */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function ChatMessage({
  role,
  content,
  sources,
  isStreaming,
}: ChatMessageProps) {
  const isUser = role === "user";

  const rendered = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      {/* Label */}
      <div
        className={`flex items-center gap-1.5 px-1 ${
          isUser ? "flex-row-reverse" : "flex-row"
        }`}
      >
        {isUser ? (
          <User className="size-3.5 text-zinc-500" />
        ) : (
          <Bot className="size-3.5 text-zinc-500" />
        )}
        <span className="text-xs font-medium text-zinc-500">
          {isUser ? "You" : "OnboardBot"}
        </span>
      </div>

      {/* Message bubble */}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "rounded-tr-sm bg-blue-600 text-white"
            : "rounded-tl-sm bg-zinc-800 text-zinc-100"
        }`}
      >
        {rendered}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-zinc-400" />
        )}
      </div>

      {/* Sources — only show for assistant messages that are done streaming */}
      {!isUser && sources && sources.length > 0 && !isStreaming && (
        <div className="mt-1 max-w-[85%]">
          <SourceCard sources={sources} />
        </div>
      )}
    </div>
  );
}
