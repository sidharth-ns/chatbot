"use client";

import { useState } from "react";
import { ChevronRight, BookOpen } from "lucide-react";
import type { Source } from "@/lib/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

interface SourceCardProps {
  sources: Source[];
}

export function SourceCard({ sources }: SourceCardProps) {
  const [open, setOpen] = useState(false);

  // Count unique files
  const uniqueFiles = new Set(sources.map((s) => s.file_name));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800">
          <ChevronRight
            className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <BookOpen className="size-3.5 shrink-0 text-zinc-500" />
          <span>
            Sources ({sources.length} section{sources.length !== 1 ? "s" : ""}{" "}
            from {uniqueFiles.size} file{uniqueFiles.size !== 1 ? "s" : ""})
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator className="bg-zinc-700" />
          <div className="px-3 py-2">
            {sources.map((source, idx) => (
              <div key={idx}>
                {idx > 0 && <Separator className="my-2 bg-zinc-700/50" />}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-200">
                    {source.file_name}
                    {source.heading_path && (
                      <span className="font-normal text-zinc-400">
                        {" "}
                        &gt; {source.heading_path}
                      </span>
                    )}
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed text-zinc-500">
                    {source.snippet}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
