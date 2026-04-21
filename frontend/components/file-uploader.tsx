"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function FileUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: (filesToUpload: File[]) => api.uploadFiles(filesToUpload),
    onSuccess: () => {
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["index-status"] });
      toast.success("Files uploaded — indexing started");
    },
    onError: () => {
      toast.error("Upload failed");
    },
  });

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(
      (f) => f.name.endsWith(".md") || f.name.endsWith(".markdown")
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !names.has(f.name))];
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
          dragOver
            ? "border-zinc-500 dark:border-zinc-400 bg-zinc-100/50 dark:bg-zinc-800/50"
            : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600"
        }`}
      >
        <Upload className="h-8 w-8 text-zinc-500 dark:text-zinc-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            Drag & drop Markdown files here
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            or click to browse (.md, .markdown)
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              addFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Selected files list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Selected files ({files.length})
          </p>
          <ul className="space-y-1">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex items-center justify-between rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                  <FileText className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                  <span className="truncate">{file.name}</span>
                  <span className="text-xs text-zinc-300 dark:text-zinc-600">
                    {formatSize(file.size)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFile(file.name)}
                  className="size-6 rounded text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>

          <Button
            onClick={() => uploadMutation.mutate(files)}
            disabled={uploadMutation.isPending}
            className="w-full"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload & Index
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
