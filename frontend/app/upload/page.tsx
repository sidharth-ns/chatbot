"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Document, DocumentDetail } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { FileUploader } from "@/components/file-uploader";
import { IndexingProgress } from "@/components/indexing-progress";
import { TreeView } from "@/components/tree-view";

function DocumentCard({ doc }: { doc: Document }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["document", doc.id],
    queryFn: () => api.getDocument(doc.id),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteDocument(doc.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["index-status"] });
      toast.success("Document deleted");
    },
  });

  const detail: DocumentDetail | undefined = detailQuery.data;

  return (
    <Card className="border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          <CardTitle className="text-zinc-900 dark:text-zinc-100">{doc.filename}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {doc.node_count} nodes
          </Badge>
        </div>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              aria-label="Delete document"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              ) : (
                <Trash2 className="h-4 w-4 text-zinc-400 dark:text-zinc-500 hover:text-red-400" />
              )}
            </Button>
          </div>
        </CardAction>
        {doc.description && (
          <CardDescription className="text-zinc-500 dark:text-zinc-400">
            {doc.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent>
        <p className="text-xs text-zinc-300 dark:text-zinc-600">
          Indexed at {new Date(doc.indexed_at).toLocaleString()}
        </p>
      </CardContent>

      {expanded && (
        <CardContent>
          {detailQuery.isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tree...
            </div>
          )}
          {detail?.tree_json && <TreeView tree_json={detail.tree_json} />}
        </CardContent>
      )}
    </Card>
  );
}

export default function UploadPage() {
  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: api.listDocuments,
    refetchInterval: 5000, // Refresh every 5s to catch newly indexed docs
  });

  const documents = documentsQuery.data ?? [];

  return (
    <div className="min-h-full overflow-y-auto bg-white dark:bg-zinc-950 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Upload & Index Documentation
          </h1>
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
            Upload Markdown files to build your knowledge base.
          </p>
        </div>

        {/* File uploader */}
        <FileUploader />

        {/* Indexing progress */}
        <IndexingProgress />

        {/* Section header */}
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
          Indexed Documents
        </h2>

        {/* Document list */}
        {documentsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <Card className="border-dashed border-zinc-200 dark:border-zinc-800 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
              No documents indexed yet. Upload some Markdown files to get
              started.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
