"use client";

import { useState, useMemo } from "react";
import { Sparkles, User, Copy, Check, ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import type { Source } from "@/lib/types";
import { SourceCard } from "@/components/source-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/* ── CodeBlock — extracted so each block can manage its own "copied" state ── */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative my-3">
      <div
        className={`flex items-center justify-between ${
          lang ? "rounded-t-lg" : "absolute right-0 top-0 rounded-tr-lg"
        } bg-zinc-100 dark:bg-zinc-800 px-3 py-1`}
      >
        {lang && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {lang}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre
        className={`overflow-x-auto bg-zinc-50 dark:bg-zinc-900 p-3 text-sm leading-relaxed ${
          lang ? "rounded-b-lg" : "rounded-lg"
        }`}
      >
        <code className="font-mono text-zinc-800 dark:text-zinc-200">
          {code}
        </code>
      </pre>
    </div>
  );
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  isStreaming?: boolean;
  createdAt?: string;
  onFeedback?: (type: "up" | "down") => void;
}

/**
 * Renders markdown-like content into React elements.
 * Handles code blocks (```), inline code (`), bold (**), italic (*),
 * headers (##), bullet/numbered lists, and basic paragraphs.
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
      const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : "";
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      elements.push(<CodeBlock key={i} lang={lang} code={code} />);
    } else if (part.trim()) {
      // Regular text — split into paragraphs
      const paragraphs = part.split(/\n\n+/);
      paragraphs.forEach((para, j) => {
        const trimmed = para.trim();
        if (!trimmed) return;

        // Check for headers (## Header)
        const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const headerText = headerMatch[2];
          const headerClasses: Record<number, string> = {
            1: "text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-4 mb-2",
            2: "text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5",
            3: "text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-2 mb-1",
            4: "text-sm font-medium text-zinc-600 dark:text-zinc-300 mt-2 mb-1",
          };
          elements.push(
            <div key={`${i}-${j}`} className={headerClasses[level] || headerClasses[4]}>
              {renderInline(headerText)}
            </div>
          );
          return;
        }

        // Check if this paragraph is a markdown table
        const lines = trimmed.split("\n");
        const tableLines = lines.filter((l) => l.trim());
        const hasTableSeparator = tableLines.some((l) => /^\|?[\s-:|]+\|?$/.test(l) && l.includes("-"));
        const hasTableRows = tableLines.filter((l) => l.includes("|")).length >= 2;

        if (hasTableSeparator && hasTableRows) {
          // Parse markdown table
          const dataRows = tableLines.filter(
            (l) => l.includes("|") && !/^\|?[\s-:|]+\|?$/.test(l)
          );

          const parseRow = (row: string) =>
            row
              .split("|")
              .map((cell) => cell.trim())
              .filter((cell) => cell !== "");

          const headerCells = dataRows.length > 0 ? parseRow(dataRows[0]) : [];
          const bodyRows = dataRows.slice(1).map(parseRow);

          elements.push(
            <div key={`${i}-${j}`} className="my-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                {headerCells.length > 0 && (
                  <thead>
                    <tr className="border-b border-zinc-300 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/80">
                      {headerCells.map((cell, ci) => (
                        <th
                          key={ci}
                          className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300"
                        >
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-zinc-200/50 dark:border-zinc-800/50 last:border-0 even:bg-zinc-50/30 dark:even:bg-zinc-900/30"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 text-zinc-500 dark:text-zinc-400"
                        >
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          return;
        }

        // Check if this paragraph is a list (lines starting with - or * or 1.)
        const isBulletList = lines.every(
          (line) => /^\s*[-*]\s/.test(line) || !line.trim()
        );
        const isNumberedList = lines.every(
          (line) => /^\s*\d+\.\s/.test(line) || !line.trim()
        );

        if (isBulletList) {
          const items = lines.filter((l) => l.trim());
          elements.push(
            <ul key={`${i}-${j}`} className="my-2 ml-4 list-disc space-y-1 text-zinc-600 dark:text-zinc-300">
              {items.map((item, k) => (
                <li key={k} className="text-sm leading-relaxed">
                  {renderInline(item.replace(/^\s*[-*]\s/, ""))}
                </li>
              ))}
            </ul>
          );
        } else if (isNumberedList) {
          const items = lines.filter((l) => l.trim());
          elements.push(
            <ol key={`${i}-${j}`} className="my-2 ml-4 list-decimal space-y-1 text-zinc-600 dark:text-zinc-300">
              {items.map((item, k) => (
                <li key={k} className="text-sm leading-relaxed">
                  {renderInline(item.replace(/^\s*\d+\.\s/, ""))}
                </li>
              ))}
            </ol>
          );
        } else {
          elements.push(
            <p key={`${i}-${j}`} className="my-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
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
 * Handles inline formatting: bold (**text**), italic (*text*), and inline code (`code`).
 */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-zinc-900 dark:text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return (
        <em key={i} className="italic text-zinc-600 dark:text-zinc-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-blue-600 dark:text-blue-300"
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
  createdAt,
  onFeedback,
}: ChatMessageProps) {
  const isUser = role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [responseCopied, setResponseCopied] = useState(false);

  const handleFeedback = (type: "up" | "down") => {
    setFeedback(type);
    onFeedback?.(type);
    toast.success("Thanks for your feedback!");
  };

  const copyResponse = () => {
    navigator.clipboard.writeText(content).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
    setResponseCopied(true);
    toast.success("Copied!");
    setTimeout(() => setResponseCopied(false), 1500);
  };

  const rendered = useMemo(() => {
    const elements = renderMarkdown(content);
    if (!isStreaming || elements.length === 0) return elements;

    // Append cursor inline inside the last element to prevent it jumping to next line
    const last = elements[elements.length - 1];
    const cursor = (
      <span
        key="__cursor"
        className="animate-stream-cursor ml-0.5 inline-block h-[0.95em] w-[2.5px] translate-y-[1px] rounded-full bg-zinc-900/90 dark:bg-white/90"
      />
    );

    // If last element is a JSX element with children, clone it and append cursor
    if (last && typeof last === "object" && "props" in last) {
      const cloned = { ...last, props: { ...last.props, children: [last.props.children, cursor] } };
      return [...elements.slice(0, -1), cloned];
    }

    // Fallback: just append after
    return [...elements, cursor];
  }, [content, isStreaming]);

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="flex items-start gap-2.5 max-w-[75%]">
          {createdAt && (
            <span className="self-center text-[10px] text-zinc-400 dark:text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
              {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <div className="rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
            {content}
          </div>
          <Avatar className="size-7 mt-0.5 shrink-0">
            <AvatarFallback className="bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
              <User className="size-3.5" />
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="group flex items-start gap-3">
      {/* Bot avatar */}
      <Avatar className="size-7 mt-0.5">
        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
          <Sparkles className="size-3.5" />
        </AvatarFallback>
      </Avatar>

      {/* Message content */}
      <div className="min-w-0 flex-1">
        <div className={`dark:prose-invert max-w-none${isStreaming ? " streaming-content" : ""}`}>
          {rendered}
        </div>

        {/* Sources — only show for assistant messages that are done streaming */}
        {sources && sources.length > 0 && !isStreaming && (
          <div className="mt-3">
            <SourceCard sources={sources} />
          </div>
        )}

        {createdAt && (
          <span className="mt-1 block text-[10px] text-zinc-400 dark:text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
            {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}

        {/* Feedback & copy buttons — only for completed assistant messages */}
        {!isStreaming && role === "assistant" && (
          <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => handleFeedback("up")}
              className={`rounded p-1 transition-colors ${
                feedback === "up"
                  ? "text-green-500 dark:text-green-400"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-500/10 dark:hover:bg-green-400/10"
              }`}
            >
              <ThumbsUp className="size-3.5" fill={feedback === "up" ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => handleFeedback("down")}
              className={`rounded p-1 transition-colors ${
                feedback === "down"
                  ? "text-red-500 dark:text-red-400"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10"
              }`}
            >
              <ThumbsDown className="size-3.5" fill={feedback === "down" ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => copyResponse()}
              className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 dark:hover:text-zinc-200 hover:bg-zinc-500/10 dark:hover:bg-zinc-400/10 transition-colors"
            >
              {responseCopied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
