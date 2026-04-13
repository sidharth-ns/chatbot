"use client";

import { useMemo } from "react";
import { Bot } from "lucide-react";
import type { Source } from "@/lib/types";
import { SourceCard } from "@/components/source-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  isStreaming?: boolean;
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
      elements.push(
        <div key={i} className="group relative my-3">
          {lang && (
            <div className="rounded-t-lg bg-zinc-800 px-3 py-1 text-xs text-zinc-400">
              {lang}
            </div>
          )}
          <pre
            className={`overflow-x-auto bg-zinc-900 p-3 text-sm leading-relaxed ${
              lang ? "rounded-b-lg" : "rounded-lg"
            }`}
          >
            <code className="font-mono text-zinc-200">{code}</code>
          </pre>
        </div>
      );
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
            1: "text-lg font-bold text-zinc-100 mt-4 mb-2",
            2: "text-base font-semibold text-zinc-100 mt-3 mb-1.5",
            3: "text-sm font-semibold text-zinc-200 mt-2 mb-1",
            4: "text-sm font-medium text-zinc-300 mt-2 mb-1",
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
            <div key={`${i}-${j}`} className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-sm">
                {headerCells.length > 0 && (
                  <thead>
                    <tr className="border-b border-zinc-700 bg-zinc-900/80">
                      {headerCells.map((cell, ci) => (
                        <th
                          key={ci}
                          className="px-3 py-2 text-left text-xs font-semibold text-zinc-300"
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
                      className="border-b border-zinc-800/50 last:border-0 even:bg-zinc-900/30"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 text-zinc-400"
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
            <ul key={`${i}-${j}`} className="my-2 ml-4 list-disc space-y-1 text-zinc-300">
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
            <ol key={`${i}-${j}`} className="my-2 ml-4 list-decimal space-y-1 text-zinc-300">
              {items.map((item, k) => (
                <li key={k} className="text-sm leading-relaxed">
                  {renderInline(item.replace(/^\s*\d+\.\s/, ""))}
                </li>
              ))}
            </ol>
          );
        } else {
          elements.push(
            <p key={`${i}-${j}`} className="my-1 text-sm leading-relaxed text-zinc-300">
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
        <strong key={i} className="font-semibold text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return (
        <em key={i} className="italic text-zinc-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-blue-300"
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

  const rendered = useMemo(() => {
    const elements = renderMarkdown(content);
    if (!isStreaming || elements.length === 0) return elements;

    // Append cursor inline inside the last element to prevent it jumping to next line
    const last = elements[elements.length - 1];
    const cursor = (
      <span
        key="__cursor"
        className="animate-stream-cursor ml-0.5 inline-block h-[0.95em] w-[2.5px] translate-y-[1px] rounded-full bg-white/90"
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
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[70%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
          {content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex items-start gap-3">
      {/* Bot avatar */}
      <Avatar size="sm" className="mt-0.5 bg-blue-600/15 ring-1 ring-blue-500/25">
        <AvatarFallback className="bg-blue-600/15">
          <Bot className="size-3.5 text-blue-400" />
        </AvatarFallback>
      </Avatar>

      {/* Message content */}
      <div className="min-w-0 flex-1">
        <div className={`prose-invert max-w-none${isStreaming ? " streaming-content" : ""}`}>
          {rendered}
        </div>

        {/* Sources — only show for assistant messages that are done streaming */}
        {sources && sources.length > 0 && !isStreaming && (
          <div className="mt-3">
            <SourceCard sources={sources} />
          </div>
        )}
      </div>
    </div>
  );
}
