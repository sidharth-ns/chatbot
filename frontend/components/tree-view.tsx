"use client";

import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TreeNode {
  node_id?: string;
  title?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

interface TreeViewProps {
  tree_json: Record<string, unknown>;
}

function TreeNodeItem({ node, depth }: { node: TreeNode; depth: number }) {
  if (depth > 5) return null;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const title = node.title || "(untitled)";
  const nodeId = node.node_id;

  if (!hasChildren) {
    return (
      <div
        className="flex items-center gap-2 py-1 text-sm text-zinc-600 dark:text-zinc-300"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="h-4 w-4" />
        {nodeId && (
          <Badge variant="secondary" className="text-[10px] font-mono">
            {nodeId}
          </Badge>
        )}
        <span className="truncate">{title}</span>
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={depth < 2}>
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 rounded py-1 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500 transition-transform [[data-panel-open]_&]:rotate-90" />
        {nodeId && (
          <Badge variant="secondary" className="text-[10px] font-mono">
            {nodeId}
          </Badge>
        )}
        <span className="truncate">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children!.map((child, i) => (
          <TreeNodeItem key={child.node_id || i} node={child} depth={depth + 1} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TreeView({ tree_json }: TreeViewProps) {
  const root = tree_json as TreeNode;

  // If the root itself is the tree, render it directly
  if (root.title || root.children) {
    return (
      <ScrollArea className="max-h-80">
        <div className="rounded-md bg-white dark:bg-zinc-950 p-2">
          <TreeNodeItem node={root} depth={0} />
        </div>
      </ScrollArea>
    );
  }

  // If tree_json is an object with named keys, render each top-level entry
  return (
    <ScrollArea className="max-h-80">
      <div className="rounded-md bg-white dark:bg-zinc-950 p-2">
        {Object.entries(tree_json).map(([key, value]) => (
          <TreeNodeItem
            key={key}
            node={{ title: key, ...(typeof value === "object" && value !== null ? value : {}) } as TreeNode}
            depth={0}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
