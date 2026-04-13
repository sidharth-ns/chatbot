"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export function IndexingProgress() {
  const { data: status } = useQuery({
    queryKey: ["index-status"],
    queryFn: api.indexStatus,
    refetchInterval: 1000,
  });

  if (!status || status.pending === 0) return null;

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
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-zinc-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
