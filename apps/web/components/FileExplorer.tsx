"use client";

import { useMemo, useState } from "react";
import type { TreeEntry } from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import { send } from "@/lib/ws-client";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(entries: TreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const map = new Map<string, TreeNode>();
  map.set("", root);

  for (const entry of entries) {
    const parts = entry.path.split("/");
    const name = parts[parts.length - 1] ?? entry.path;
    const parentPath = parts.slice(0, -1).join("/");
    const parent = map.get(parentPath) ?? root;
    const node: TreeNode = {
      name,
      path: entry.path,
      isDir: entry.is_dir,
      children: [],
    };
    parent.children.push(node);
    if (entry.is_dir) map.set(entry.path, node);
  }

  function sortRec(n: TreeNode): void {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  }
  sortRec(root);
  return root.children;
}

export default function FileExplorer({ onClose }: { onClose: () => void }) {
  const tree = useStore((s) => s.tree);
  const selected = useStore((s) => s.selectedFile);
  const openFile = useStore((s) => s.openFile);
  const nodes = useMemo(() => buildTree(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));

  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label-micro">Files</span>
        <div className="actions">
          <button
            type="button"
            onClick={() => send({ type: "request_tree" })}
            className="icon-btn-sm"
            title="Refresh"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn-sm"
            title="Hide files"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="tree-list">
        {nodes.length === 0 && <div className="tree-empty">No files yet.</div>}
        {nodes.map((node) => (
          <Row
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={openFile}
            selected={selected}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  selected,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  selected: string | null;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = !node.isDir && selected === node.path;

  const handleClick = (): void => {
    if (node.isDir) {
      onToggle(node.path);
    } else {
      onOpenFile(node.path);
      send({ type: "request_file", path: node.path });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`tree-row ${isSelected ? "active" : ""}`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        {node.isDir ? (
          <span className="chev">{isOpen ? "▾" : "▸"}</span>
        ) : (
          <span className="chev" />
        )}
        <span className={`name ${node.isDir ? "folder-name" : ""}`}>
          {node.name}
          {node.isDir ? "/" : ""}
        </span>
      </button>
      {node.isDir &&
        isOpen &&
        node.children.map((child) => (
          <Row
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            selected={selected}
          />
        ))}
    </>
  );
}
