"use client";

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
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          disabled={disabled}
          className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-50"
        >
          {question}
        </button>
      ))}
    </div>
  );
}
