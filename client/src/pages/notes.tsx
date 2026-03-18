import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Upload,
  Search,
  MessageSquare,
} from "lucide-react";
import { ContextChat, type ContextItem } from "@/components/context-chat";
import { marked } from "marked";
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

export default function NotesPage() {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string>("/");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFolder, setNewFolder] = useState("/");
  const [chatOpen, setChatOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dumpFileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: () => apiRequest("GET", "/api/notes").then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: folders = [] } = useQuery<string[]>({
    queryKey: ["/api/notes/folders"],
    queryFn: () => apiRequest("GET", "/api/notes/folders").then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const createNote = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/notes", data).then(r => r.json()),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/folders"] });
      setSelectedNote(note);
      setEditMode(true);
      setEditTitle(note.title);
      setEditContent(note.content);
      setShowNewNote(false);
      setNewTitle("");
    },
  });

  const updateNote = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/notes/${id}`, data).then(r => r.json()),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedNote(note);
      toast({ title: "Note saved" });
    },
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes/folders"] });
      setSelectedNote(null);
      setEditMode(false);
    },
  });

  const handleSave = () => {
    if (!selectedNote) return;
    updateNote.mutate({ id: selectedNote.id, title: editTitle, content: editContent });
    setEditMode(false);
  };

  const handleImageUpload = async (file: File) => {
    if (!selectedNote) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/notes/${selectedNote.id}/assets`, { method: "POST", body: formData });
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
      await fetch("/api/notes/inbox/dump", { method: "POST", body: formData });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({ title: "Dumped to inbox" });
    } catch {}
  };

  const filteredNotes = notes
    .filter(n => selectedFolder === "/" ? true : n.folder === selectedFolder || n.folder.startsWith(selectedFolder + "/"))
    .filter(n => !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="flex-1 flex flex-col h-full">
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
          <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => {
            dumpFileRef.current?.click();
          }}>
            <Inbox className="w-3.5 h-3.5" /> Quick Dump
          </Button>
          <input ref={dumpFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleDump(undefined, f);
          }} />
          <Button size="sm" variant="default" className="text-xs gap-1" onClick={() => setShowNewNote(true)} data-testid="button-new-note">
            <Plus className="w-3.5 h-3.5" /> New Note
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Folder + Note list */}
        <div className="w-72 border-r border-border/50 flex flex-col shrink-0">
          <div className="p-2 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search notes..."
                className="h-8 text-xs pl-7"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-notes"
              />
            </div>
          </div>

          {/* Folder filter */}
          <div className="p-2 border-b border-border/50">
            <Select value={selectedFolder} onValueChange={setSelectedFolder}>
              <SelectTrigger className="h-7 text-xs">
                <Folder className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="/">All Notes</SelectItem>
                {folders.filter(f => f !== "/").map(f => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-1.5">
              {filteredNotes.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No notes yet</p>
              )}
              {filteredNotes.map(note => (
                <button
                  key={note.id}
                  onClick={() => {
                    setSelectedNote(note);
                    setEditMode(false);
                    setEditTitle(note.title);
                    setEditContent(note.content);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg mb-0.5 transition-colors ${
                    selectedNote?.id === note.id
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted/50 text-foreground"
                  }`}
                  data-testid={`note-item-${note.id}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {note.pinned && <Pin className="w-2.5 h-2.5 text-primary" />}
                    <span className="text-xs font-medium truncate">{note.title}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{note.content.slice(0, 80)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] text-muted-foreground/60">{note.folder}</span>
                    <span className="text-[9px] text-muted-foreground/60">·</span>
                    <span className="text-[9px] text-muted-foreground/60">{new Date(note.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Note content area */}
        <div className={`flex-1 flex flex-col min-w-0 ${chatOpen ? 'max-w-[calc(100%-20rem-18rem)]' : ''}`}>
          {!selectedNote ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select or create a note</p>
              </div>
            </div>
          ) : (
            <>
              {/* Note toolbar */}
              <div className="flex items-center gap-2 px-4 h-10 border-b border-border/50 shrink-0">
                {editMode ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-7 text-xs font-medium border-0 bg-transparent p-0 focus-visible:ring-0"
                    data-testid="input-note-title"
                  />
                ) : (
                  <span className="text-xs font-medium">{selectedNote.title}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {editMode ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
                        <Image className="w-3 h-3" /> Image
                      </Button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageUpload(f);
                      }} />
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleSave} data-testid="button-save-note">
                        <Save className="w-3 h-3" /> Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditMode(true)} data-testid="button-edit-note">
                        <Edit3 className="w-3 h-3" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive" onClick={() => deleteNote.mutate(selectedNote.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto p-4">
                {editMode ? (
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onPaste={handlePaste}
                    className="min-h-[500px] text-sm font-mono resize-none border-0 bg-transparent focus-visible:ring-0 p-0"
                    placeholder="Write markdown..."
                    data-testid="input-note-content"
                  />
                ) : (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none [&_img]:rounded-lg [&_img]:max-w-[500px]"
                    dangerouslySetInnerHTML={{ __html: marked.parse(selectedNote.content) as string }}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Context-aware AI chat panel */}
        <ContextChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          context={selectedNote ? [{
            type: "note" as const,
            title: selectedNote.title,
            content: selectedNote.content,
            id: selectedNote.id,
          }] : []}
          placeholder={selectedNote ? `Ask about "${selectedNote.title}"...` : "Select a note first..."}
        />
      </div>

      {/* New note dialog */}
      <Dialog open={showNewNote} onOpenChange={setShowNewNote}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">New Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Note title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="text-sm"
              data-testid="input-new-note-title"
            />
            <Select value={newFolder} onValueChange={setNewFolder}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="/">Root</SelectItem>
                <SelectItem value="/inbox">Inbox</SelectItem>
                <SelectItem value="/projects">Projects</SelectItem>
                <SelectItem value="/personal">Personal</SelectItem>
                <SelectItem value="/work">Work</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="w-full text-sm"
              onClick={() => createNote.mutate({ title: newTitle || "Untitled", content: "", folder: newFolder })}
              data-testid="button-create-note"
            >
              Create Note
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
