"use client";

import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuggestionChipsProps {
  questions: string[];
  onSelect: (q: string) => void;
  disabled?: boolean;
}

export function SuggestionChips({
  questions,
  onSelect,
  disabled,
}: SuggestionChipsProps) {
  return (
    <div
      className={`flex flex-wrap gap-2 ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          onClick={() => onSelect(question)}
          disabled={disabled}
          className="group h-auto rounded-xl border-zinc-800 bg-zinc-900/50 px-3.5 py-2 text-[13px] leading-snug text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 hover:shadow-sm active:scale-[0.98]"
        >
          <span>{question}</span>
          <ArrowUpRight className="size-3 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-60" />
        </Button>
      ))}
    </div>
  );
}
