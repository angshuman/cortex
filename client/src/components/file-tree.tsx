import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  File,
  Image as ImageIcon,
  FileCode,
  Table2,
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  FilePlus,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  ext?: string;
  size?: number;
  children?: FileNode[];
}

interface FileTreeProps {
  vaultId: string;
  selectedPath?: string | null;
  onFileSelect: (node: FileNode) => void;
  onAddToContext?: (node: FileNode) => void;
}

function getFileIcon(node: FileNode) {
  if (node.type === "directory") return null; // handled separately
  const ext = (node.ext || "").toLowerCase();
  if (["md", "txt", "doc", "docx"].includes(ext)) return <FileText className="w-3.5 h-3.5 shrink-0 text-blue-400/80" />;
  if (["pdf"].includes(ext)) return <BookOpen className="w-3.5 h-3.5 shrink-0 text-red-400/80" />;
  if (["xlsx", "xls", "csv"].includes(ext)) return <Table2 className="w-3.5 h-3.5 shrink-0 text-green-400/80" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(ext)) return <ImageIcon className="w-3.5 h-3.5 shrink-0 text-purple-400/80" />;
  if (["js", "ts", "jsx", "tsx", "py", "go", "rs", "java", "cpp", "c", "sh"].includes(ext)) return <FileCode className="w-3.5 h-3.5 shrink-0 text-yellow-400/80" />;
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return <FileCode className="w-3.5 h-3.5 shrink-0 text-orange-400/80" />;
  return <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />;
}

interface ContextMenu {
  x: number;
  y: number;
  node: FileNode;
}

interface RenameState {
  path: string;
  name: string;
}

interface CreateState {
  parentPath: string;
  type: "file" | "directory";
  name: string;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onToggle,
  onSelect,
  onContextMenu,
  renamingNode,
  onRenameCommit,
  onRenameChange,
  onRenameCancel,
  onAddToContext,
}: {
  node: FileNode;
  depth: number;
  selectedPath?: string | null;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  renamingNode: RenameState | null;
  onRenameCommit: () => void;
  onRenameChange: (name: string) => void;
  onRenameCancel: () => void;
  onAddToContext?: (node: FileNode) => void;
}){
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDir = node.type === "directory";
  const isRenaming = renamingNode?.path === node.path;
  const indent = depth * 12;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 pr-2 rounded-sm cursor-pointer select-none group
          ${isSelected ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground hover:text-foreground"}`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={() => { if (isDir) onToggle(node.path); else onSelect(node); }}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node); }}
        draggable={!isDir}
        onDragStart={!isDir ? (e) => {
          e.dataTransfer.setData("cortex/filepath", node.path);
          e.dataTransfer.setData("cortex/filename", node.name);
        } : undefined}
      >
        {/* Expand/collapse arrow */}
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
          {isDir ? (
            isExpanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
          ) : null}
        </span>

        {/* Icon */}
        {isDir
          ? (isExpanded
            ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-yellow-400/80" />
            : <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-400/80" />)
          : getFileIcon(node)}

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            autoFocus
            value={renamingNode!.name}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameCommit();
              if (e.key === "Escape") onRenameCancel();
            }}
            className="flex-1 text-xs bg-background border border-primary/50 rounded px-1 py-0 outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-xs truncate flex-1 leading-5">{node.name}</span>
        )}
        {!isDir && !isRenaming && onAddToContext && (
          <button
            className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded-sm hover:bg-primary/20 text-muted-foreground hover:text-primary transition-all shrink-0"
            title="Add to chat context"
            onClick={(e) => { e.stopPropagation(); onAddToContext(node); }}
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Children */}
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              renamingNode={renamingNode}
              onRenameCommit={onRenameCommit}
              onRenameChange={onRenameChange}
              onRenameCancel={onRenameCancel}
              onAddToContext={onAddToContext}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ vaultId, selectedPath, onFileSelect, onAddToContext }: FileTreeProps) {
  const queryClient = useQueryClient();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renamingNode, setRenamingNode] = useState<RenameState | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const { data: tree = [], isLoading, refetch } = useQuery<FileNode[]>({
    queryKey: ["/api/vaults", vaultId, "files"],
    queryFn: () => apiRequest("GET", `/api/vaults/${vaultId}/files`).then(r => r.json()),
    staleTime: 5000,
    refetchOnWindowFocus: false,
  });

  const createFile = useMutation({
    mutationFn: (body: { filePath: string; type: "file" | "directory" }) =>
      apiRequest("POST", `/api/vaults/${vaultId}/files`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vaults", vaultId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    },
  });

  const renameFile = useMutation({
    mutationFn: (body: { filePath: string; newName: string }) =>
      apiRequest("PATCH", `/api/vaults/${vaultId}/files`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vaults", vaultId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    },
  });

  const deleteFile = useMutation({
    mutationFn: (filePath: string) =>
      apiRequest("DELETE", `/api/vaults/${vaultId}/files?path=${encodeURIComponent(filePath)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vaults", vaultId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    },
  });

  // Close context menu on outside click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleRenameStart = (node: FileNode) => {
    setRenamingNode({ path: node.path, name: node.name });
    setContextMenu(null);
  };

  const handleRenameCommit = () => {
    if (!renamingNode || !renamingNode.name.trim()) { setRenamingNode(null); return; }
    if (renamingNode.name !== renamingNode.path.split("/").pop()) {
      renameFile.mutate({ filePath: renamingNode.path, newName: renamingNode.name.trim() });
    }
    setRenamingNode(null);
  };

  const handleDelete = (node: FileNode) => {
    if (!confirm(`Delete "${node.name}"${node.type === "directory" ? " and all its contents" : ""}?`)) return;
    deleteFile.mutate(node.path);
    setContextMenu(null);
  };

  const handleNewFile = (parentPath: string) => {
    setCreating({ parentPath, type: "file", name: "untitled.md" });
    if (parentPath) setExpandedDirs(prev => new Set([...prev, parentPath]));
    setContextMenu(null);
  };

  const handleNewFolder = (parentPath: string) => {
    setCreating({ parentPath, type: "directory", name: "New Folder" });
    if (parentPath) setExpandedDirs(prev => new Set([...prev, parentPath]));
    setContextMenu(null);
  };

  const handleCreateCommit = () => {
    if (!creating || !creating.name.trim()) { setCreating(null); return; }
    const filePath = creating.parentPath
      ? `${creating.parentPath}/${creating.name.trim()}`
      : creating.name.trim();
    createFile.mutate({ filePath, type: creating.type });
    setCreating(null);
  };

  const renderCreateInput = (parentPath: string) => {
    if (!creating || creating.parentPath !== parentPath) return null;
    const depth = parentPath ? parentPath.split("/").length : 0;
    return (
      <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
        {creating.type === "directory"
          ? <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-400/80" />
          : <FileText className="w-3.5 h-3.5 shrink-0 text-blue-400/80" />}
        <input
          autoFocus
          value={creating.name}
          onChange={(e) => setCreating(prev => prev ? { ...prev, name: e.target.value } : null)}
          onBlur={handleCreateCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateCommit();
            if (e.key === "Escape") setCreating(null);
          }}
          className="flex-1 text-xs bg-background border border-primary/50 rounded px-1 py-0 outline-none"
        />
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50">
        Loading files…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/30 shrink-0">
        <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider flex-1">Files</span>
        <Button size="icon" variant="ghost" className="h-5 w-5" title="New file" onClick={() => handleNewFile("")}>
          <FilePlus className="w-3 h-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-5 w-5" title="New folder" onClick={() => handleNewFolder("")}>
          <FolderPlus className="w-3 h-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-5 w-5" title="Refresh" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {renderCreateInput("")}
        {tree.length === 0 && (
          <div className="text-center py-8 text-[11px] text-muted-foreground/40">
            Empty folder
          </div>
        )}
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            onToggle={toggleDir}
            onSelect={onFileSelect}
            onContextMenu={handleContextMenu}
            renamingNode={renamingNode}
            onRenameCommit={handleRenameCommit}
            onRenameChange={(name) => setRenamingNode(prev => prev ? { ...prev, name } : null)}
            onRenameCancel={() => setRenamingNode(null)}
            onAddToContext={onAddToContext}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-popover border border-border/50 rounded-lg shadow-lg py-1 min-w-[140px] text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.type === "directory" && (
            <>
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/60 text-left"
                onClick={() => handleNewFile(contextMenu.node.path)}
              >
                <FilePlus className="w-3.5 h-3.5 opacity-60" /> New File
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/60 text-left"
                onClick={() => handleNewFolder(contextMenu.node.path)}
              >
                <FolderPlus className="w-3.5 h-3.5 opacity-60" /> New Folder
              </button>
              <div className="my-1 border-t border-border/30" />
            </>
          )}
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/60 text-left"
            onClick={() => handleRenameStart(contextMenu.node)}
          >
            <Pencil className="w-3.5 h-3.5 opacity-60" /> Rename
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/60 text-left text-destructive"
            onClick={() => handleDelete(contextMenu.node)}
          >
            <Trash2 className="w-3.5 h-3.5 opacity-60" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
