"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
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

  // When indexing finishes (was indexing → now not), refresh documents list
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        Indexing in progress...
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {status.indexed} of {total} documents indexed ({pct}%)
      </p>
      <Progress value={pct} className="mt-3 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-zinc-400" />
    </div>
  );
}
