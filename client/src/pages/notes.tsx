import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Plus,
  Folder,
  Trash2,
  Save,
  Image,
  Eye,
  Edit3,
  Inbox,
  Pin,
  PinOff,
  Search,
  MessageSquare,
  MoreHorizontal,
  Bold,
  Italic,
  Code,
  LinkIcon,
  ListOrdered,
  List,
  Heading2,
  Quote,
  ImageIcon,
  Minus,
  X,
  Loader2,
  Clock,
  FolderOpen,
  Tag,
  ChevronRight,
} from "lucide-react";
import { ContextChat, type ContextItem } from "@/components/context-chat";
import { ResizeHandle, useResizablePanel } from "@/components/resize-handle";
import { ImageLightbox, useImageLightbox } from "@/components/image-lightbox";
import { marked } from "@/lib/marked-config";
import { useToast } from "@/hooks/use-toast";

interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  attachments: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============ Markdown Toolbar ============
function MarkdownToolbar({
  textareaRef,
  onInsert,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (text: string) => void;
}) {
  const wrap = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    const replacement = `${before}${selected || "text"}${after}`;
    const newValue = ta.value.substring(0, start) + replacement + ta.value.substring(end);
    onInsert(newValue);
    // Restore focus & selection
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + (selected || "text").length;
    }, 10);
  };

  const insertLine = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(start);
    const needsNewline = before.length > 0 && !before.endsWith("\n");
    const insertion = `${needsNewline ? "\n" : ""}${prefix} `;
    const newValue = before + insertion + after;
    onInsert(newValue);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + insertion.length;
    }, 10);
  };

  const tools = [
    { icon: Bold, label: "Bold", action: () => wrap("**", "**") },
    { icon: Italic, label: "Italic", action: () => wrap("*", "*") },
    { icon: Code, label: "Code", action: () => wrap("`", "`") },
    { icon: LinkIcon, label: "Link", action: () => wrap("[", "](url)") },
    { divider: true },
    { icon: Heading2, label: "Heading", action: () => insertLine("##") },
    { icon: List, label: "Bullet List", action: () => insertLine("-") },
    { icon: ListOrdered, label: "Numbered List", action: () => insertLine("1.") },
    { icon: Quote, label: "Quote", action: () => insertLine(">") },
    { icon: Minus, label: "Divider", action: () => insertLine("---") },
  ];

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 bg-muted/20">
      {tools.map((tool, i) => {
        if ("divider" in tool && tool.divider) {
          return <div key={i} className="w-px h-4 bg-border/50 mx-1" />;
        }
        const Icon = tool.icon!;
        return (
          <Button
            key={i}
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={tool.action}
            title={tool.label}
          >
            <Icon className="w-3 h-3" />
          </Button>
        );
      })}
    </div>
  );
}

// ============ Note List Item ============
function NoteListItem({
  note,
  isSelected,
  isInContext,
  onSelect,
  onToggleContext,
}: {
  note: Note;
  isSelected: boolean;
  isInContext: boolean;
  onSelect: () => void;
  onToggleContext: () => void;
}) {
  const previewText = useMemo(() => {
    return note.content
      .replace(/!\[.*?\]\(.*?\)/g, "[image]")
      .replace(/[#*_`\[\]>]/g, "")
      .replace(/\n+/g, " ")
      .trim()
      .slice(0, 100);
  }, [note.content]);

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(note.updatedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, [note.updatedAt]);

  return (
    <button
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onToggleContext();
        } else {
          onSelect();
        }
      }}
      className={`w-full text-left p-3 rounded-lg transition-colors ${
        isSelected
          ? "bg-primary/8 border border-primary/15"
          : isInContext
          ? "bg-primary/5 border border-primary/10"
          : "hover:bg-muted/40 border border-transparent"
      }`}
      data-testid={`note-item-${note.id}`}
      title={isInContext ? "Ctrl+Click to remove from context" : "Ctrl+Click to add to AI context"}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {isInContext && <MessageSquare className="w-2.5 h-2.5 text-primary shrink-0" />}
            {note.pinned && <Pin className="w-2.5 h-2.5 text-primary shrink-0" />}
            <span className="text-[13px] font-medium truncate text-foreground">{note.title}</span>
          </div>
          {previewText && (
            <p className="text-[11px] text-muted-foreground/60 line-clamp-2 leading-relaxed">{previewText}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo}
            </span>
            {note.tags.length > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">
                {note.tags[0]}{note.tags.length > 1 ? ` +${note.tags.length - 1}` : ""}
              </Badge>
            )}
            {note.attachments.length > 0 && (
              <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                <ImageIcon className="w-2.5 h-2.5" />
                {note.attachments.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ============ Main Notes Page ============
export default function NotesPage() {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [chatOpen, setChatOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [contextNoteIds, setContextNoteIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dumpFileRef = useRef<HTMLInputElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { vaultParam, vaultId } = useVault();
  const { lightbox, handleContainerClick, closeLightbox } = useImageLightbox();

  const noteList = useResizablePanel({ defaultWidth: 280, minWidth: 200, maxWidth: 420, storageKey: "cortex-notes-list-width" });
  const chatPanel = useResizablePanel({ defaultWidth: 420, minWidth: 280, maxWidth: 800, storageKey: "cortex-notes-chat-width", reverse: true });

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/notes", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/notes", vaultParam)).then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !!vaultId,
  });



  const createNote = useMutation({
    mutationFn: (data: any) => apiRequest("POST", withVault("/api/notes", vaultParam), data).then(r => r.json()),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedNote(note);
      setEditMode(true);
      setViewMode("edit");
      setEditTitle(note.title);
      setEditContent(note.content);
    },
  });

  const updateNote = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", withVault(`/api/notes/${id}`, vaultParam), data).then(r => r.json()),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedNote(note);
    },
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", withVault(`/api/notes/${id}`, vaultParam)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedNote(null);
      setEditMode(false);
    },
  });

  const handleSave = useCallback(() => {
    if (!selectedNote) return;
    updateNote.mutate({ id: selectedNote.id, title: editTitle, content: editContent });
    setEditMode(false);
    toast({ title: "Note saved" });
  }, [selectedNote, editTitle, editContent, updateNote, toast]);

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && editMode) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, handleSave]);

  const handleImageUpload = async (file: File) => {
    if (!selectedNote) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(withVault(`/api/notes/${selectedNote.id}/assets`, vaultParam), { method: "POST", body: formData });
      const data = await res.json();
      const imgMd = `\n![${file.name}](${data.url})\n`;
      setEditContent(prev => prev + imgMd);
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleImageUpload(file);
      }
    }
  };

  const handleDump = async (text?: string, file?: File) => {
    const formData = new FormData();
    formData.append("title", `Dump ${new Date().toLocaleString()}`);
    if (text) formData.append("content", text);
    if (file) formData.append("file", file);
    try {
      await fetch(withVault("/api/notes/inbox/dump", vaultParam), { method: "POST", body: formData });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({ title: "Dumped to inbox" });
    } catch {}
  };

  const togglePin = (note: Note) => {
    updateNote.mutate({ id: note.id, pinned: !note.pinned });
  };

  const filteredNotes = useMemo(() =>
    notes
      .filter(n => !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [notes, searchQuery]
  );

  const selectNote = (note: Note) => {
    setSelectedNote(note);
    setEditMode(false);
    setViewMode("edit");
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  // Sync selectedNote from fresh query data (e.g. after AI updates the note)
  useEffect(() => {
    if (!selectedNote) return;
    const fresh = notes.find(n => n.id === selectedNote.id);
    if (!fresh) return;
    // Only update if the note actually changed
    if (fresh.updatedAt !== selectedNote.updatedAt) {
      setSelectedNote(fresh);
      // Update edit fields only if NOT actively editing
      if (!editMode) {
        setEditTitle(fresh.title);
        setEditContent(fresh.content);
      }
    }
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNoteContext = useCallback((noteId: string) => {
    setContextNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const handleAddContext = useCallback((item: ContextItem) => {
    if (item.id) {
      setContextNoteIds(prev => new Set(prev).add(item.id!));
    }
  }, []);

  const handleRemoveContext = useCallback((id: string) => {
    setContextNoteIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Build the chat context: all explicitly added notes + the selected note
  const chatContext = useMemo(() => {
    const ids = new Set(contextNoteIds);
    if (selectedNote) ids.add(selectedNote.id);
    return notes
      .filter(n => ids.has(n.id))
      .map(n => ({
        type: "note" as const,
        title: n.title,
        content: n.content,
        id: n.id,
      }));
  }, [contextNoteIds, selectedNote, notes]);

  // All notes as available items for @mention
  const availableItems = useMemo(() =>
    notes.map(n => ({
      type: "note" as const,
      title: n.title,
      content: n.content,
      id: n.id,
    })),
    [notes]
  );

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Notes</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={chatOpen ? "secondary" : "ghost"}
            className="text-xs gap-1"
            onClick={() => setChatOpen(!chatOpen)}
            data-testid="button-toggle-chat"
          >
            <MessageSquare className="w-3.5 h-3.5" /> AI
          </Button>
          <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => { dumpFileRef.current?.click(); }}>
            <Inbox className="w-3.5 h-3.5" /> Quick Dump
          </Button>
          <input ref={dumpFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleDump(undefined, f);
          }} />
          <Button size="sm" variant="default" className="text-xs gap-1" onClick={() => createNote.mutate({ title: "Untitled", content: "" })} data-testid="button-new-note">
            <Plus className="w-3.5 h-3.5" /> New Note
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar: Folders + Note list */}
        <div className="border-r border-border/50 flex flex-col shrink-0" style={{ width: noteList.width }}>
          <div className="p-2 space-y-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Search notes..."
                className="h-8 text-xs pl-8 bg-muted/30 border-border/30"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-notes"
              />
            </div>


          </div>

          {/* Notes list */}
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {filteredNotes.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-10 h-10 rounded-xl bg-muted/20 flex items-center justify-center mx-auto mb-2">
                    <FileText className="w-4.5 h-4.5 text-muted-foreground/20" />
                  </div>
                  <p className="text-[11px] text-muted-foreground/40">No notes yet</p>
                  <p className="text-[10px] text-muted-foreground/25 mt-0.5">Create one to get started</p>
                </div>
              )}
              {filteredNotes.map(note => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  isSelected={selectedNote?.id === note.id}
                  isInContext={contextNoteIds.has(note.id)}
                  onSelect={() => selectNote(note)}
                  onToggleContext={() => toggleNoteContext(note.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        <ResizeHandle onMouseDown={noteList.onMouseDown} isResizing={noteList.isResizing} />

        {/* Note content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedNote ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted/20 border border-dashed border-border/40 flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-6 h-6 text-muted-foreground/20" />
                </div>
                <p className="text-sm text-muted-foreground/50">Select or create a note</p>
                <p className="text-[11px] text-muted-foreground/25 mt-1">Full markdown with images, Ctrl+V to paste</p>
              </div>
            </div>
          ) : (
            <>
              {/* Note toolbar */}
              <div className="flex items-center gap-2 px-4 h-11 border-b border-border/50 shrink-0">
                {editMode ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-7 text-[13px] font-semibold border-0 bg-transparent p-0 focus-visible:ring-0 flex-1"
                    data-testid="input-note-title"
                  />
                ) : (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[13px] font-semibold truncate">{selectedNote.title}</span>

                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  {editMode ? (
                    <>
                      {/* View mode toggle (edit/preview) */}
                      <div className="flex rounded-md border border-border/30 mr-1">
                        <Button
                          variant={viewMode === "edit" ? "secondary" : "ghost"}
                          size="icon"
                          className="h-6 w-6 rounded-r-none"
                          onClick={() => setViewMode("edit")}
                          title="Edit"
                        >
                          <Edit3 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant={viewMode === "preview" ? "secondary" : "ghost"}
                          size="icon"
                          className="h-6 w-6 rounded-l-none"
                          onClick={() => setViewMode("preview")}
                          title="Preview"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
                        <ImageIcon className="w-3 h-3" /> Image
                      </Button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageUpload(f);
                      }} />
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditMode(false); setEditTitle(selectedNote.title); setEditContent(selectedNote.content); }}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleSave} data-testid="button-save-note">
                        <Save className="w-3 h-3" /> Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setEditMode(true); setViewMode("edit"); }} data-testid="button-edit-note">
                        <Edit3 className="w-3 h-3" /> Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => togglePin(selectedNote)} className="text-xs gap-2">
                            {selectedNote.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                            {selectedNote.pinned ? "Unpin" : "Pin to top"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteNote.mutate(selectedNote.id)}
                            className="text-xs text-destructive gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete note
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>

              {/* Content */}
              {editMode ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {viewMode === "edit" && (
                    <MarkdownToolbar
                      textareaRef={editTextareaRef}
                      onInsert={(text) => setEditContent(text)}
                    />
                  )}
                  <div className="flex-1 overflow-auto">
                    {viewMode === "edit" ? (
                      <Textarea
                        ref={editTextareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onPaste={handlePaste}
                        className="min-h-full h-full text-sm font-mono resize-none border-0 rounded-none bg-transparent focus-visible:ring-0 p-4 leading-relaxed"
                        placeholder="Write markdown here... (paste images with Ctrl+V)"
                        data-testid="input-note-content"
                      />
                    ) : (
                      <div className="p-4">
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none [&_img]:rounded-lg [&_img]:max-w-[600px] [&_img]:cursor-pointer [&_img]:hover:opacity-90 [&_img]:transition-opacity [&_p]:mb-3 [&_ul]:mb-3 [&_ol]:mb-3 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:text-xs [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
                          dangerouslySetInnerHTML={{ __html: marked.parse(editContent) as string }}
                          onClick={handleContainerClick}
                        />
                      </div>
                    )}
                  </div>
                  {/* Status bar */}
                  <div className="flex items-center gap-3 px-4 h-7 border-t border-border/30 bg-muted/20 shrink-0">
                    <span className="text-[10px] text-muted-foreground/40">
                      {editContent.split(/\s+/).filter(Boolean).length} words
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {editContent.length} chars
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {editContent.split("\n").length} lines
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground/40">
                      Markdown supported · Ctrl+S to save
                    </span>
                  </div>
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="p-5 max-w-3xl">
                    {/* Note metadata */}
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border/30">
                      <span className="text-[10px] text-muted-foreground/40">
                        Updated {new Date(selectedNote.updatedAt).toLocaleString()}
                      </span>
                      {selectedNote.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {selectedNote.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1">
                              <Tag className="w-2 h-2" />{tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedNote.content ? (
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none [&_img]:rounded-lg [&_img]:max-w-[600px] [&_img]:cursor-pointer [&_img]:hover:opacity-90 [&_img]:transition-opacity [&_p]:mb-3 [&_ul]:mb-3 [&_ol]:mb-3 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:text-xs [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
                        dangerouslySetInnerHTML={{ __html: marked.parse(selectedNote.content) as string }}
                        onClick={handleContainerClick}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground/40 italic">Empty note — click Edit to add content</p>
                    )}
                  </div>
                </ScrollArea>
              )}
            </>
          )}
        </div>

        {/* Context-aware AI chat panel */}
        {chatOpen && <ResizeHandle onMouseDown={chatPanel.onMouseDown} isResizing={chatPanel.isResizing} />}
        <ContextChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          width={chatPanel.width}
          context={chatContext}
          availableItems={availableItems}
          onAddContext={handleAddContext}
          onRemoveContext={handleRemoveContext}
          placeholder={
            chatContext.length > 1
              ? `${chatContext.length} notes in context — ask anything...`
              : chatContext.length === 1
              ? `Ask about "${chatContext[0].title}"...`
              : "Select a note or type @ to add..."
          }
        />
      </div>


      {/* Image lightbox */}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          open={!!lightbox}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
