"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeEntry } from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import { send } from "@/lib/ws-client";
import { fileOpApi } from "@/lib/api";

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

/**
 * Resolve a file's display label + accent color from its name. Drives the
 * VSCode-Seti-inspired SVG file glyph below. Single source of truth — both
 * the tree and the quick-open palette read from here.
 *
 * Special-cased filenames (package.json, Dockerfile, etc.) are detected
 * before extension fallback so they get distinctive colors.
 */
function fileMeta(name: string): { label: string; color: string } {
  const lower = name.toLowerCase();
  // Filename matches first.
  if (lower === "package.json") return { label: "{}", color: "#cb3837" };
  if (lower === "package-lock.json") return { label: "{}", color: "#888" };
  if (lower === "tsconfig.json") return { label: "{}", color: "#3178c6" };
  if (lower === "dockerfile" || lower === "dockerfile.dev") return { label: "DK", color: "#2496ed" };
  if (lower === ".gitignore" || lower === ".gitattributes") return { label: "GIT", color: "#f05033" };
  if (lower === ".env" || lower.startsWith(".env.")) return { label: "ENV", color: "#ecd06f" };
  if (lower === "readme.md" || lower === "readme") return { label: "RM", color: "#519aba" };
  if (lower === "license" || lower === "license.md") return { label: "LIC", color: "#999" };
  if (lower === "cargo.toml") return { label: "RS", color: "#dea584" };
  if (lower === "go.mod" || lower === "go.sum") return { label: "GO", color: "#00add8" };
  if (lower === "fly.toml") return { label: "FLY", color: "#824ff1" };
  if (lower === "nixpacks.toml") return { label: "NIX", color: "#7e7eff" };

  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "ts": return { label: "TS", color: "#3178c6" };
    case "tsx": return { label: "TSX", color: "#3178c6" };
    case "js": case "mjs": case "cjs": return { label: "JS", color: "#f0db4f" };
    case "jsx": return { label: "JSX", color: "#f0db4f" };
    case "py": return { label: "PY", color: "#3b82f6" };
    case "go": return { label: "GO", color: "#00add8" };
    case "rs": return { label: "RS", color: "#dea584" };
    case "json": return { label: "{}", color: "#cba253" };
    case "md": case "mdx": return { label: "MD", color: "#519aba" };
    case "css": case "scss": case "sass": case "less":
      return { label: "CSS", color: "#519aba" };
    case "html": case "htm": return { label: "<>", color: "#e34c26" };
    case "yml": case "yaml": return { label: "YML", color: "#cb171e" };
    case "toml": return { label: "TOM", color: "#9c4221" };
    case "sh": case "bash": case "zsh": case "fish":
      return { label: "SH", color: "#4eaa25" };
    case "sql": return { label: "SQL", color: "#336791" };
    case "env": return { label: "ENV", color: "#ecd06f" };
    case "lock": return { label: "LCK", color: "#888" };
    case "svg": return { label: "SVG", color: "#ffb13b" };
    case "png": case "jpg": case "jpeg": case "gif": case "webp": case "ico":
      return { label: "IMG", color: "#ad7bd6" };
    case "pdf": return { label: "PDF", color: "#dc2626" };
    case "txt": return { label: "TXT", color: "#9ca3af" };
    case "csv": return { label: "CSV", color: "#10b981" };
    case "xml": return { label: "XML", color: "#fb923c" };
    case "vue": return { label: "VUE", color: "#42b883" };
    case "svelte": return { label: "SV", color: "#ff3e00" };
    case "rb": return { label: "RB", color: "#cc342d" };
    case "java": return { label: "JV", color: "#f89820" };
    case "c": case "h": return { label: "C", color: "#a8b9cc" };
    case "cpp": case "cc": case "cxx": case "hpp":
      return { label: "C++", color: "#00599c" };
    case "kt": case "kts": return { label: "KT", color: "#a97bff" };
    case "swift": return { label: "SW", color: "#fa7343" };
    default:
      return { label: ext ? ext.slice(0, 3).toUpperCase() : "•", color: "#9ca3af" };
  }
}

export default function FileExplorer({ onClose }: { onClose: () => void }) {
  const tree = useStore((s) => s.tree);
  const selected = useStore((s) => s.selectedFile);
  const openFile = useStore((s) => s.openFile);
  const project = useStore((s) => s.project);
  const addSystem = useStore((s) => s.addSystem);
  const nodes = useMemo(() => buildTree(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<{
    parent: string;
    type: "file" | "dir";
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);

  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // When the user types in search, expand matching parents so results
  // are visible without manual chevron-clicks.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches: TreeEntry[] = [];
    for (const entry of tree) {
      if (entry.is_dir) continue;
      if (entry.path.toLowerCase().includes(q)) {
        matches.push(entry);
      }
    }
    matches.sort((a, b) => a.path.localeCompare(b.path));
    return matches;
  }, [tree, query]);

  const reqOpen = (path: string): void => {
    openFile(path);
    send({ type: "request_file", path });
  };

  const wrapAction = async (fn: () => Promise<void>): Promise<void> => {
    if (actionsBusy) return;
    setActionsBusy(true);
    try {
      await fn();
    } catch (err) {
      addSystem(`file op failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionsBusy(false);
    }
  };

  const onCreate = (parent: string, type: "file" | "dir") => {
    setCreating({ parent, type });
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
  };

  const submitCreate = async (rawName: string): Promise<void> => {
    if (!project || !creating) return;
    const trimmed = rawName.trim();
    setCreating(null);
    if (!trimmed) return;
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      addSystem("file op failed: name cannot contain '/' — create the parent dir first");
      return;
    }
    const target = creating.parent ? `${creating.parent}/${trimmed}` : trimmed;
    await wrapAction(async () => {
      if (creating.type === "dir") {
        await fileOpApi(project.id, { op: "create_dir", path: target });
        return;
      }
      // New file: write empty content via the existing client_write_file
      // path. That gives us auto-save semantics for free; the server emits
      // the file_changed broadcast that refreshes the tree.
      send({ type: "client_write_file", path: target, content: "" });
      reqOpen(target);
    });
  };

  const submitRename = async (oldPath: string, newName: string): Promise<void> => {
    if (!project) return;
    const trimmed = newName.trim();
    setRenaming(null);
    if (!trimmed) return;
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      addSystem("rename failed: new name cannot contain '/'");
      return;
    }
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
    const target = parent ? `${parent}/${trimmed}` : trimmed;
    if (target === oldPath) return;
    await wrapAction(() =>
      fileOpApi(project.id, { op: "rename", from: oldPath, to: target }).then(() => {}),
    );
  };

  const submitDelete = async (path: string): Promise<void> => {
    if (!project) return;
    setConfirmDelete(null);
    await wrapAction(() =>
      fileOpApi(project.id, { op: "delete", path }).then(() => {}),
    );
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="label-micro">Files</span>
        <div className="actions">
          <button
            type="button"
            onClick={() => onCreate("", "file")}
            className="icon-btn-sm"
            title="New file at root"
            disabled={!project}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="13" x2="12" y2="19" />
              <line x1="9" y1="16" x2="15" y2="16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onCreate("", "dir")}
            className="icon-btn-sm"
            title="New folder at root"
            disabled={!project}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
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
      <div className="tree-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files…"
        />
      </div>
      <div className="tree-list">
        {filtered ? (
          filtered.length === 0 ? (
            <div className="tree-empty">No matches.</div>
          ) : (
            filtered.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => reqOpen(entry.path)}
                className={`tree-row ${selected === entry.path ? "active" : ""}`}
                style={{ paddingLeft: "8px" }}
              >
                <FileGlyph name={entry.path.split("/").pop() ?? entry.path} />
                <span className="name" title={entry.path}>
                  {highlightMatch(entry.path, query)}
                </span>
              </button>
            ))
          )
        ) : (
          <>
            {nodes.length === 0 && !creating && (
              <div className="tree-empty">No files yet.</div>
            )}
            {/* Inline creator at root */}
            {creating && creating.parent === "" && (
              <InlineRow
                depth={0}
                isDir={creating.type === "dir"}
                placeholder={creating.type === "dir" ? "new-folder" : "new-file.ts"}
                onSubmit={(value) => void submitCreate(value)}
                onCancel={() => setCreating(null)}
              />
            )}
            {nodes.map((node) => (
              <Row
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                onOpenFile={reqOpen}
                selected={selected}
                renaming={renaming}
                creating={creating}
                onStartRename={(p) => setRenaming(p)}
                onSubmitRename={(p, name) => void submitRename(p, name)}
                onCancelRename={() => setRenaming(null)}
                onAskDelete={(p) => setConfirmDelete(p)}
                onCreateChild={(parent, type) => onCreate(parent, type)}
                onSubmitCreate={(value) => void submitCreate(value)}
                onCancelCreate={() => setCreating(null)}
              />
            ))}
          </>
        )}
      </div>
      {confirmDelete && (
        <DeleteConfirm
          path={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void submitDelete(confirmDelete)}
        />
      )}
      <QuickOpen tree={tree} onOpen={reqOpen} />
    </div>
  );
}

function highlightMatch(path: string, query: string): React.ReactNode {
  const q = query.toLowerCase();
  if (!q) return path;
  const idx = path.toLowerCase().indexOf(q);
  if (idx < 0) return path;
  return (
    <>
      {path.slice(0, idx)}
      <mark>{path.slice(idx, idx + q.length)}</mark>
      {path.slice(idx + q.length)}
    </>
  );
}

/**
 * VSCode-Seti-inspired file icon. Document outline + folded corner + a small
 * accent bar at the bottom in the language's brand color, with a 2-3 char
 * label inside the bar. Looks like the file icons in VSCode without
 * shipping a 200-icon asset bundle.
 */
function FileGlyph({ name }: { name: string }) {
  const { label, color } = fileMeta(name);
  // 14×16 viewBox → renders at the same visual size as the previous square
  // glyph but as a recognizable file shape.
  return (
    <span className="file-glyph" style={{ background: "transparent", color }}>
      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
        <path
          d="M2.5 1.5h6L12 5v9a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.6"
        />
        <path
          d="M8.5 1.5V5H12"
          fill="rgba(255,255,255,0.10)"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.6"
        />
        <rect x="1.5" y="11" width="10.5" height="3.5" fill={color} rx="0.5" />
        <text
          x="6.75"
          y="13.65"
          textAnchor="middle"
          fontFamily="-apple-system, 'Segoe UI', Roboto, sans-serif"
          fontSize={label.length >= 3 ? "2.6" : "3.1"}
          fontWeight="700"
          fill="#ffffff"
          letterSpacing="0.05"
        >
          {label}
        </text>
      </svg>
    </span>
  );
}

/**
 * VSCode-style folder icon — open variant has the lid lifted. Uses the
 * Seti-style amber color for closed folders, slightly lighter for open.
 */
function FolderGlyph({ open }: { open: boolean }) {
  const fill = open ? "#e8a73d" : "#d59c45";
  const tab = open ? "#c87d2a" : "#a86f24";
  return (
    <span className="folder-glyph" style={{ background: "transparent" }}>
      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
        <path
          d="M1.5 4.25a1 1 0 0 1 1-1h3l1.4 1.5h5.6a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4.25z"
          fill={fill}
          stroke="rgba(0,0,0,0.25)"
          strokeWidth="0.4"
        />
        {open && (
          <path
            d="M2.5 7.5h10l-1 5.5a1 1 0 0 1-1 .8H3.5a1 1 0 0 1-1-1V7.5z"
            fill={tab}
            opacity="0.65"
          />
        )}
      </svg>
    </span>
  );
}

function Row({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  selected,
  renaming,
  creating,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onAskDelete,
  onCreateChild,
  onSubmitCreate,
  onCancelCreate,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  selected: string | null;
  renaming: string | null;
  creating: { parent: string; type: "file" | "dir" } | null;
  onStartRename: (path: string) => void;
  onSubmitRename: (path: string, newName: string) => void;
  onCancelRename: () => void;
  onAskDelete: (path: string) => void;
  onCreateChild: (parent: string, type: "file" | "dir") => void;
  onSubmitCreate: (value: string) => void;
  onCancelCreate: () => void;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = !node.isDir && selected === node.path;
  const isRenaming = renaming === node.path;

  if (isRenaming) {
    return (
      <InlineRow
        depth={depth}
        isDir={node.isDir}
        initialValue={node.name}
        placeholder={node.name}
        onSubmit={(value) => onSubmitRename(node.path, value)}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <>
      <div
        className={`tree-row-wrap ${isSelected ? "active" : ""}`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => (node.isDir ? onToggle(node.path) : onOpenFile(node.path))}
          className="tree-row"
        >
          {node.isDir ? (
            <span className="chev">{isOpen ? "▾" : "▸"}</span>
          ) : (
            <span className="chev" />
          )}
          {node.isDir ? <FolderGlyph open={isOpen} /> : <FileGlyph name={node.name} />}
          <span className={`name ${node.isDir ? "folder-name" : ""}`}>
            {node.name}
            {node.isDir ? "/" : ""}
          </span>
        </button>
        <RowActions
          isDir={node.isDir}
          onRename={() => onStartRename(node.path)}
          onDelete={() => onAskDelete(node.path)}
          onNewFile={() => onCreateChild(node.path, "file")}
          onNewFolder={() => onCreateChild(node.path, "dir")}
        />
      </div>
      {node.isDir && isOpen && creating && creating.parent === node.path && (
        <InlineRow
          depth={depth + 1}
          isDir={creating.type === "dir"}
          placeholder={creating.type === "dir" ? "new-folder" : "new-file.ts"}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}
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
            renaming={renaming}
            creating={creating}
            onStartRename={onStartRename}
            onSubmitRename={onSubmitRename}
            onCancelRename={onCancelRename}
            onAskDelete={onAskDelete}
            onCreateChild={onCreateChild}
            onSubmitCreate={onSubmitCreate}
            onCancelCreate={onCancelCreate}
          />
        ))}
    </>
  );
}

function RowActions({
  isDir,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: {
  isDir: boolean;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="tree-row-actions">
      {isDir && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewFile();
            }}
            title="New file in this folder"
            className="icon-btn-xs"
          >
            +F
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewFolder();
            }}
            title="New folder in this folder"
            className="icon-btn-xs"
          >
            +D
          </button>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        title="Rename"
        className="icon-btn-xs"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        className="icon-btn-xs danger"
      >
        ×
      </button>
    </div>
  );
}

function InlineRow({
  depth,
  isDir,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div className="tree-row-wrap" style={{ paddingLeft: `${4 + depth * 12}px` }}>
      <span className="chev" />
      {isDir ? <FolderGlyph open /> : <FileGlyph name={value || "x"} />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onBlur={() => {
          if (value.trim()) onSubmit(value);
          else onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="tree-inline-input"
      />
    </div>
  );
}

function DeleteConfirm({
  path,
  onCancel,
  onConfirm,
}: {
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="proj-dialog-overlay" onClick={onCancel}>
      <div className="proj-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete "{path}"?</h3>
        <p className="proj-dialog-warn">
          Removes the file (or folder + everything inside) from the sandbox
          and from Storage. The agent's history is unaffected.
        </p>
        <div className="proj-dialog-actions">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-danger">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cmd/Ctrl+P palette. Mounts portal-style at the bottom of the explorer
 * pane (rendered via React tree, not via createPortal — the dialog uses
 * fixed positioning so DOM placement doesn't matter).
 */
function QuickOpen({
  tree,
  onOpen,
}: {
  tree: TreeEntry[];
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isMac = /mac/i.test(navigator.platform);
      const isModP =
        (isMac ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "p";
      if (isModP) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const files = tree.filter((e) => !e.is_dir);
    if (!q) return files.slice(0, 50);
    return files
      .map((e) => ({ entry: e, score: fuzzyScore(e.path.toLowerCase(), q) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((m) => m.entry);
  }, [tree, query]);

  if (!open) return null;
  return (
    <div className="quick-open-overlay" onClick={() => setOpen(false)}>
      <div className="quick-open" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          placeholder="Type a path…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = matches[activeIdx];
              if (pick) {
                onOpen(pick.path);
                setOpen(false);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <div className="quick-open-list">
          {matches.length === 0 && <div className="quick-open-empty">No files match.</div>}
          {matches.map((entry, i) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => {
                onOpen(entry.path);
                setOpen(false);
              }}
              className={`quick-open-row ${i === activeIdx ? "active" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <FileGlyph name={entry.path.split("/").pop() ?? entry.path} />
              <span className="quick-open-row-name">
                {entry.path.split("/").pop()}
              </span>
              <span className="quick-open-row-dir">
                {entry.path.includes("/")
                  ? entry.path.slice(0, entry.path.lastIndexOf("/"))
                  : ""}
              </span>
            </button>
          ))}
        </div>
        <div className="quick-open-hint">
          ↑ ↓ navigate · enter open · esc close
        </div>
      </div>
    </div>
  );
}

/**
 * Cheap subsequence-match fuzzy score. Higher = better. Returns 0 when
 * the query characters can't be found in order. Bonuses for matching at
 * a path boundary (after `/`) and for consecutive matches — both proxies
 * for "matches the filename, not the directory."
 */
function fuzzyScore(haystack: string, needle: string): number {
  let score = 0;
  let h = 0;
  let lastMatch = -2;
  for (let n = 0; n < needle.length; n++) {
    const ch = needle[n];
    let found = -1;
    for (; h < haystack.length; h++) {
      if (haystack[h] === ch) {
        found = h;
        break;
      }
    }
    if (found < 0) return 0;
    score += 1;
    if (found === lastMatch + 1) score += 2;
    if (found === 0 || haystack[found - 1] === "/") score += 3;
    lastMatch = found;
    h++;
  }
  return score;
}
