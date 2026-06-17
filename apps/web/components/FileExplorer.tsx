"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeEntry } from "@uniqus/api-types";
import { useStore } from "@/lib/store";
import { send } from "@/lib/ws-client";
import { fileOpApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { resolveSetiIcon } from "@/lib/seti-icons";

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

export default function FileExplorer({
  onClose,
  onFileOpened,
}: {
  onClose: () => void;
  /** Fired after a file is opened. On mobile, the workspace uses this to jump
   *  from the files pane to the editor so the opened file is actually shown. */
  onFileOpened?: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const treeLoaded = useStore((s) => s.treeLoaded);
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
  // Right-click / ⋯ context menu (UI/UX audit gap #6).
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const treeListRef = useRef<HTMLDivElement>(null);

  // Arrow-key navigation across the visible (flattened) rows — the rows are
  // rendered in visible order in the DOM, so we can move focus by querying the
  // .tree-row buttons rather than threading a roving-tabindex through the
  // recursive tree (UI/UX audit §B).
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = Array.from(
      treeListRef.current?.querySelectorAll<HTMLButtonElement>(".tree-row") ?? [],
    );
    if (rows.length === 0) return;
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next =
      e.key === "ArrowDown"
        ? Math.min(rows.length - 1, idx + 1)
        : e.key === "ArrowUp"
        ? Math.max(0, idx - 1)
        : e.key === "Home"
        ? 0
        : rows.length - 1;
    rows[next]?.focus();
  };

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
    onFileOpened?.();
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
    // Creating a file writes empty content, which would silently truncate an
    // existing file (the server write is unconditional). The full tree is in
    // memory, so refuse any collision up front.
    const existing = tree.find((e) => e.path === target);
    if (existing) {
      toast.error(
        `${existing.is_dir ? "A folder" : "A file"} named "${target}" already exists`,
      );
      return;
    }
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
    // Backslashes are never valid path separators here.
    if (trimmed.includes("\\")) {
      addSystem("rename failed: name cannot contain '\\'");
      return;
    }
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
    // A "/" in the new name means a path-move: absolute (leading "/") is relative
    // to the project root; otherwise it's relative to the file's current parent.
    // The rename op already accepts a full destination path (§B — was rejected).
    let target: string;
    if (trimmed.includes("/")) {
      const raw = trimmed.startsWith("/")
        ? trimmed.slice(1)
        : parent
        ? `${parent}/${trimmed}`
        : trimmed;
      target = normalizePath(raw);
      if (!target) {
        addSystem("rename failed: invalid destination path");
        return;
      }
    } else {
      target = parent ? `${parent}/${trimmed}` : trimmed;
    }
    if (target === oldPath) return;
    await wrapAction(() =>
      fileOpApi(project.id, { op: "rename", from: oldPath, to: target }).then(() => {}),
    );
  };

  // Move a node into a target folder ("" = project root) by reusing the rename
  // op — drives drag-and-drop and the context menu's move affordances.
  const moveInto = async (fromPath: string, destDir: string): Promise<void> => {
    if (!project) return;
    const base = fromPath.includes("/") ? fromPath.slice(fromPath.lastIndexOf("/") + 1) : fromPath;
    const to = destDir ? `${destDir}/${base}` : base;
    if (to === fromPath) return;
    // Guard against dropping a folder into itself or a descendant.
    if (destDir === fromPath || destDir.startsWith(`${fromPath}/`)) return;
    await wrapAction(() =>
      fileOpApi(project.id, { op: "rename", from: fromPath, to }).then(() => {}),
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
            aria-label="New file at root"
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
            aria-label="New folder at root"
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
            aria-label="Refresh file tree"
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
            aria-label="Hide files panel"
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
      <div
        className="tree-list"
        ref={treeListRef}
        role="tree"
        aria-label="Files"
        onKeyDown={onTreeKeyDown}
        // Drop onto empty space = move to project root.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/uniqus-path")) e.preventDefault();
        }}
        onDrop={(e) => {
          const from = e.dataTransfer.getData("text/uniqus-path");
          if (from) {
            e.preventDefault();
            void moveInto(from, "");
          }
        }}
      >
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
        ) : !treeLoaded ? (
          // Loading skeleton — distinguishes "tree not arrived yet" from a
          // genuinely empty project (§B).
          <div style={{ display: "grid", gap: 6, padding: "4px 8px" }} aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="ide-skeleton-row"
                style={{ width: `${80 - i * 8}%`, height: 14 }}
              />
            ))}
          </div>
        ) : (
          <>
            {nodes.length === 0 && !creating && (
              <div className="tree-empty">
                No files yet.
                <div className="tree-empty-actions">
                  <button type="button" onClick={() => onCreate("", "file")} disabled={!project}>
                    New file
                  </button>
                  <button type="button" onClick={() => onCreate("", "dir")} disabled={!project}>
                    New folder
                  </button>
                </div>
              </div>
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
                onContextMenu={(n, x, y) => setMenu({ node: n, x, y })}
                onMoveNode={(from, destDir) => void moveInto(from, destDir)}
              />
            ))}
          </>
        )}
      </div>
      {menu && (
        <RowContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenaming(menu.node.path);
            setMenu(null);
          }}
          onDelete={() => {
            setConfirmDelete(menu.node.path);
            setMenu(null);
          }}
          onNewFile={() => {
            onCreate(menu.node.path, "file");
            setMenu(null);
          }}
          onNewFolder={() => {
            onCreate(menu.node.path, "dir");
            setMenu(null);
          }}
          onCopyPath={() => {
            navigator.clipboard?.writeText(menu.node.path).catch(() => {});
            setMenu(null);
          }}
        />
      )}
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

/** Collapse `.`/`..` segments and strip empties so a typed path-move is sane. */
function normalizePath(raw: string): string {
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
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
 * VS Code "Seti" file icon — the exact glyph + color VS Code's built-in default
 * file icon theme renders. The glyph is a character in the `seti` font (loaded
 * via @font-face in globals.css); `resolveSetiIcon` maps the filename to the
 * right codepoint + color using VS Code's own Seti theme data. The `.file-glyph`
 * wrapper is shared with `FolderGlyph` for consistent layout/centering.
 */
function FileGlyph({ name }: { name: string }) {
  const { char, color } = resolveSetiIcon(name);
  return (
    <span className="file-glyph" aria-hidden="true">
      <span className="seti-icon" style={{ color }}>
        {char}
      </span>
    </span>
  );
}

/**
 * VSCode default-style folder icon — simple flat folder shape.
 * Open variant tilts the lid up.
 */
function FolderGlyph({ open }: { open: boolean }) {
  return (
    <span className="folder-glyph" style={{ background: "transparent" }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {open ? (
          <>
            <path d="M1.5 3.5a1 1 0 0 1 1-1h3.1l1.4 1.5h6a1 1 0 0 1 1 1v1H4.5l-3 7V3.5z" fill="#dcb67a" />
            <path d="M1.5 12l3-7H14l-3 7H1.5z" fill="#e8ce93" />
          </>
        ) : (
          <path
            d="M1.5 3.5a1 1 0 0 1 1-1h3.1l1.4 1.5h6a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
            fill="#c09553"
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
  onContextMenu,
  onMoveNode,
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
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  onMoveNode: (from: string, destDir: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = !node.isDir && selected === node.path;
  const isRenaming = renaming === node.path;
  const [dropTarget, setDropTarget] = useState(false);

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
        className={`tree-row-wrap ${isSelected ? "active" : ""}${dropTarget ? " drop-target" : ""}`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={node.isDir ? isOpen : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(node, e.clientX, e.clientY);
        }}
        // Drop target: dragging a node onto a folder moves it inside (§B).
        onDragOver={
          node.isDir
            ? (e) => {
                if (e.dataTransfer.types.includes("text/uniqus-path")) {
                  e.preventDefault();
                  setDropTarget(true);
                }
              }
            : undefined
        }
        onDragLeave={node.isDir ? () => setDropTarget(false) : undefined}
        // Attached to BOTH file and dir rows: always consume a drop that carries
        // a dragged path so it can't bubble to the .tree-list root handler (which
        // moves the node to the project root). That bubbling turned a natural
        // "drop on itself / on a file to cancel" gesture into a destructive
        // move-to-root. Only a directory row that isn't the source performs the
        // move; everything else just swallows the event.
        onDrop={(e) => {
          if (node.isDir) setDropTarget(false);
          const from = e.dataTransfer.getData("text/uniqus-path");
          if (!from) return;
          e.preventDefault();
          e.stopPropagation();
          if (node.isDir && from !== node.path) onMoveNode(from, node.path);
        }}
      >
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/uniqus-path", node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => (node.isDir ? onToggle(node.path) : onOpenFile(node.path))}
          onKeyDown={(e) => {
            if (e.key === "F2") {
              e.preventDefault();
              onStartRename(node.path);
            } else if (e.key === "Delete") {
              e.preventDefault();
              onAskDelete(node.path);
            } else if (node.isDir && e.key === "ArrowRight" && !isOpen) {
              e.preventDefault();
              onToggle(node.path);
            } else if (node.isDir && e.key === "ArrowLeft" && isOpen) {
              e.preventDefault();
              onToggle(node.path);
            }
          }}
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
          onMore={(x, y) => onContextMenu(node, x, y)}
        />
      </div>
      {node.isDir && isOpen && (
        <div role="group">
          {creating && creating.parent === node.path && (
            <InlineRow
              depth={depth + 1}
              isDir={creating.type === "dir"}
              placeholder={creating.type === "dir" ? "new-folder" : "new-file.ts"}
              onSubmit={onSubmitCreate}
              onCancel={onCancelCreate}
            />
          )}
          {node.children.map((child) => (
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
              onContextMenu={onContextMenu}
              onMoveNode={onMoveNode}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RowActions({
  isDir,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onMore,
}: {
  isDir: boolean;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  /** Open the full action menu at the given viewport coords (touch + overflow). */
  onMore: (x: number, y: number) => void;
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
            aria-label="New file in this folder"
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
            aria-label="New folder in this folder"
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
        aria-label="Rename"
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
        aria-label="Delete"
        className="icon-btn-xs danger"
      >
        ×
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onMore(r.right, r.bottom);
        }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        className="icon-btn-xs"
      >
        ⋯
      </button>
    </div>
  );
}

/** Right-click / ⋯ menu for a tree row. Closes on outside click or Escape. */
function RowContextMenu({
  node,
  x,
  y,
  onClose,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
}: {
  node: TreeNode;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onCopyPath: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Keep the menu on-screen (rough clamp to the viewport).
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 180);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 200);

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left, top }}>
      <button type="button" role="menuitem" onClick={onRename}>
        Rename
      </button>
      <button type="button" role="menuitem" className="danger" onClick={onDelete}>
        Delete
      </button>
      {node.isDir && (
        <>
          <div className="ctx-menu-sep" />
          <button type="button" role="menuitem" onClick={onNewFile}>
            New file
          </button>
          <button type="button" role="menuitem" onClick={onNewFolder}>
            New folder
          </button>
        </>
      )}
      <div className="ctx-menu-sep" />
      <button type="button" role="menuitem" onClick={onCopyPath}>
        Copy path
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
  // Commit only on Enter; blur cancels. Prevents accidental creates/renames
  // when focus is lost, and the Enter→blur double-fire (§C).
  const committedRef = useRef(false);
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
        aria-label={isDir ? "Folder name" : "File name"}
        onBlur={() => {
          // If the user already committed with Enter, don't re-fire; otherwise a
          // blur is a cancel (no silent create on click-away).
          if (!committedRef.current) onCancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            committedRef.current = true;
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
