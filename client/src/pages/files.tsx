import { useState, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Upload,
  Trash2,
  FileText,
  Image as ImageIcon,
  File,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Search,
  MoreHorizontal,
  StickyNote,
  Download,
  Eye,
  Grid3X3,
  List,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  url: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.includes("pdf")) return FileText;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("rar")) return FileArchive;
  if (mimeType.includes("javascript") || mimeType.includes("typescript") || mimeType.includes("json") || mimeType.includes("html") || mimeType.includes("css")) return FileCode;
  if (mimeType.includes("text")) return FileText;
  return File;
}

function FileCard({ file, onDelete, onCreateNote, onPreview }: {
  file: FileItem;
  onDelete: (id: string) => void;
  onCreateNote: (id: string) => void;
  onPreview: (file: FileItem) => void;
}) {
  const Icon = getFileIcon(file.mimeType);
  const isImage = file.mimeType.startsWith("image/");
  const vaultParam = useVault().vaultParam;

  return (
    <div
      className="group relative rounded-lg border border-border/40 bg-card card-hover cursor-pointer overflow-hidden"
      onClick={() => onPreview(file)}
      data-testid={`file-card-${file.id}`}
    >
      {/* Preview area */}
      <div className="aspect-[4/3] bg-muted/20 flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img
            src={withVault(file.url, vaultParam)}
            alt={file.name}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
              <Icon className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider font-medium">
              {file.name.split(".").pop()}
            </span>
          </div>
        )}
      </div>

      {/* File info */}
      <div className="p-2.5">
        <p className="text-xs font-medium truncate text-foreground" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground/60">{formatFileSize(file.size)}</span>
          <span className="text-[10px] text-muted-foreground/40">
            {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      </div>

      {/* Actions (on hover) */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-6 w-6 bg-background/80 backdrop-blur-sm shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPreview(file); }} className="text-xs gap-2">
              <Eye className="w-3.5 h-3.5" /> Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCreateNote(file.id); }} className="text-xs gap-2">
              <StickyNote className="w-3.5 h-3.5" /> Create Note
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                const a = document.createElement("a");
                a.href = withVault(file.url, vaultParam);
                a.download = file.name;
                a.click();
              }}
              className="text-xs gap-2"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
              className="text-xs text-destructive gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function FileListRow({ file, onDelete, onCreateNote, onPreview }: {
  file: FileItem;
  onDelete: (id: string) => void;
  onCreateNote: (id: string) => void;
  onPreview: (file: FileItem) => void;
}) {
  const Icon = getFileIcon(file.mimeType);
  const vaultParam = useVault().vaultParam;

  return (
    <div
      className="group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => onPreview(file)}
      data-testid={`file-row-${file.id}`}
    >
      <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground/60" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate text-foreground">{file.name}</p>
        <p className="text-[10px] text-muted-foreground/50">
          {formatFileSize(file.size)} · {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onCreateNote(file.id); }} title="Create note">
          <StickyNote className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            const a = document.createElement("a");
            a.href = withVault(file.url, vaultParam);
            a.download = file.name;
            a.click();
          }}
          title="Download"
        >
          <Download className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(file.id); }} title="Delete">
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export default function FilesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { vaultParam, vaultId } = useVault();
  const [, setLocation] = useLocation();

  const { data: files = [], isLoading } = useQuery<FileItem[]>({
    queryKey: ["/api/files", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/files", vaultParam)).then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !!vaultId,
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(withVault("/api/files", vaultParam), { method: "POST", body: formData });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "File uploaded" });
    },
    onError: () => {
      toast({ title: "Upload failed", variant: "destructive" });
    },
  });

  const deleteFile = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", withVault(`/api/files/${id}`, vaultParam)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setPreviewFile(null);
      toast({ title: "File deleted" });
    },
  });

  const createNoteFromFile = useMutation({
    mutationFn: (fileId: string) => apiRequest("POST", withVault(`/api/files/${fileId}/create-note`, vaultParam)).then(r => r.json()),
    onSuccess: (note: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({ title: "Note created" });
      setLocation(`/notes`);
    },
  });

  const handleUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => uploadFile.mutate(f));
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const filteredFiles = useMemo(() =>
    files.filter(f => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [files, searchQuery]
  );

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <FolderOpen className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Files</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
            <Input
              placeholder="Search files..."
              className="h-7 text-xs pl-7 w-44 bg-muted/30 border-border/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-files"
            />
          </div>
          <div className="flex rounded-md border border-border/50">
            <Button
              size="sm"
              variant={view === "grid" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 rounded-r-none"
              onClick={() => setView("grid")}
            >
              <Grid3X3 className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 rounded-l-none"
              onClick={() => setView("list")}
            >
              <List className="w-3 h-3" />
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
          />
          <Button
            size="sm"
            variant="default"
            className="text-xs gap-1"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-upload-file"
          >
            <Upload className="w-3.5 h-3.5" /> Upload
          </Button>
        </div>
      </header>

      {/* Drop zone + content */}
      <div
        className="flex-1 overflow-auto relative"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-primary/5 border-2 border-dashed border-primary/30 rounded-lg m-4 flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-8 h-8 text-primary/50 mx-auto mb-2" />
              <p className="text-sm text-primary/70 font-medium">Drop files here</p>
            </div>
          </div>
        )}

        {/* Upload in progress */}
        {uploadFile.isPending && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-primary">Uploading...</span>
          </div>
        )}

        {/* Empty state */}
        {filteredFiles.length === 0 && !isLoading && !uploadFile.isPending && (
          <div
            className="flex flex-col items-center justify-center h-full cursor-pointer group/empty"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-16 h-16 rounded-2xl bg-muted/20 border border-dashed border-border/50 flex items-center justify-center mb-3 transition-colors group-hover/empty:border-primary/30 group-hover/empty:bg-primary/5">
              <Upload className="w-6 h-6 text-muted-foreground/25 transition-colors group-hover/empty:text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground/50 mb-1">No files yet</p>
            <p className="text-[11px] text-muted-foreground/30">Drop files here or click to upload</p>
          </div>
        )}

        {/* Grid view */}
        {filteredFiles.length > 0 && view === "grid" && (
          <div className="p-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {filteredFiles.map(file => (
              <FileCard
                key={file.id}
                file={file}
                onDelete={(id) => deleteFile.mutate(id)}
                onCreateNote={(id) => createNoteFromFile.mutate(id)}
                onPreview={setPreviewFile}
              />
            ))}
          </div>
        )}

        {/* List view */}
        {filteredFiles.length > 0 && view === "list" && (
          <div className="p-4 max-w-3xl mx-auto">
            {filteredFiles.map(file => (
              <FileListRow
                key={file.id}
                file={file}
                onDelete={(id) => deleteFile.mutate(id)}
                onCreateNote={(id) => createNoteFromFile.mutate(id)}
                onPreview={setPreviewFile}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewFile} onOpenChange={(v) => { if (!v) setPreviewFile(null); }}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle className="text-sm font-medium truncate">{previewFile?.name}</DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="px-5 pb-5">
              {previewFile.mimeType.startsWith("image/") ? (
                <img
                  src={withVault(previewFile.url, vaultParam)}
                  alt={previewFile.name}
                  className="w-full max-h-[60vh] object-contain rounded-lg bg-muted/20"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  {(() => { const Icon = getFileIcon(previewFile.mimeType); return <Icon className="w-12 h-12 text-muted-foreground/30 mb-3" />; })()}
                  <p className="text-sm text-muted-foreground">{previewFile.name}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-1">{formatFileSize(previewFile.size)} · {previewFile.mimeType}</p>
                </div>
              )}
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/30">
                <span className="text-[10px] text-muted-foreground/50 flex-1">
                  Uploaded {new Date(previewFile.createdAt).toLocaleString()}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => createNoteFromFile.mutate(previewFile.id)}
                >
                  <StickyNote className="w-3 h-3" /> Create Note
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = withVault(previewFile.url, vaultParam);
                    a.download = previewFile.name;
                    a.click();
                  }}
                >
                  <Download className="w-3 h-3" /> Download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-destructive"
                  onClick={() => deleteFile.mutate(previewFile.id)}
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
