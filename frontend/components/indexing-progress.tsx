"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function IndexingProgress() {
  const queryClient = useQueryClient();
  const wasIndexing = useRef(false);

  const { data: status } = useQuery({
    queryKey: ["index-status"],
    queryFn: api.indexStatus,
    refetchInterval: 1000,
  });

  const isIndexing = status && status.pending > 0;

  useEffect(() => {
    if (wasIndexing.current && !isIndexing) {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["index-status"] });
    }
    wasIndexing.current = !!isIndexing;
  }, [isIndexing, queryClient]);

  if (!isIndexing) return null;

  const total = status.indexed + status.pending;
  const pct = total > 0 ? Math.round((status.indexed / total) * 100) : 0;

  return (
    <Card className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        Indexing in progress...
      </div>
      <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        {status.indexed} of {total} files completed
        {status.current_file && (
          <span className="ml-1 text-zinc-500 dark:text-zinc-400">
            — processing {status.current_file}
          </span>
        )}
      </p>
      <Progress
        value={pct}
        className="mt-3 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-zinc-100 dark:[&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-blue-500"
      />
      <p className="mt-1.5 text-right text-[11px] text-zinc-300 dark:text-zinc-600">{pct}%</p>
    </Card>
  );
}
