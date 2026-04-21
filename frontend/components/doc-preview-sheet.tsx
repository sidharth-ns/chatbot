"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TreeView } from "@/components/tree-view";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface DocPreviewSheetProps {
  docId: string | null;
  filename: string;
  onClose: () => void;
}

export function DocPreviewSheet({ docId, filename, onClose }: DocPreviewSheetProps) {
  const { data: doc, isLoading } = useQuery({
    queryKey: ["document", docId],
    queryFn: () => api.getDocument(docId!),
    enabled: !!docId,
  });

  return (
    <Sheet open={!!docId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="w-[400px] sm:w-[500px]">
        <SheetHeader>
          <SheetTitle>{filename}</SheetTitle>
          <SheetDescription>
            {doc && (
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{doc.node_count} sections</Badge>
                {doc.description && <span>{doc.description}</span>}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 overflow-auto">
          {isLoading && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</p>
          )}
          {doc?.tree_json && <TreeView tree_json={doc.tree_json} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
