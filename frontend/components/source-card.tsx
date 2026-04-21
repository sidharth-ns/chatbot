"use client";

import { useState } from "react";
import { ChevronRight, BookOpen } from "lucide-react";
import type { Source } from "@/lib/types";
import { Card } from "@/components/ui/card";
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
      <Card className="border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500 dark:text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300">
          <ChevronRight
            className={`size-3 shrink-0 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <BookOpen className="size-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
          <span>
            Sources ({sources.length} from {uniqueFiles.size} file
            {uniqueFiles.size !== 1 ? "s" : ""})
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator className="border-zinc-200 dark:border-zinc-800" />
          <div className="px-3 py-2">
            {sources.map((source, idx) => (
              <div key={idx}>
                {idx > 0 && <div className="my-1.5 border-t border-zinc-200/50 dark:border-zinc-800/50" />}
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {source.file_name}
                    {source.heading_path && (
                      <span className="font-normal text-zinc-400 dark:text-zinc-500">
                        {" "}
                        &gt; {source.heading_path}
                      </span>
                    )}
                  </p>
                  <p className="line-clamp-2 text-xs italic leading-relaxed text-zinc-400 dark:text-zinc-500">
                    {source.snippet}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
