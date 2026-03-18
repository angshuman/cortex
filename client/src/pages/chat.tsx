import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Send,
  Brain,
  Wrench,
  MessageSquare,
  AlertCircle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Plus,
  Image as ImageIcon,
  X,
  Paperclip,
} from "lucide-react";
import { marked } from "marked";
import { useImagePaste } from "@/hooks/use-image-paste";

interface ChatEvent {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export default function ChatPage() {
  const [, params] = useRoute("/chat/:id");
  const [location, setLocation] = useLocation();
  const sessionId = params?.id;
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "done">("idle");
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { vaultParam, vaultId, activeVault } = useVault();
  const {
    pendingImages, uploadedImages, hasImages, allUploaded, isUploading,
    addImage, removeImage, clearImages, handlePaste, handleDrop, handleDragOver,
  } = useImagePaste(vaultParam);
  const [isDragging, setIsDragging] = useState(false);

  // Load existing session
  const { data: session } = useQuery({
    queryKey: ["/api/chat/sessions", sessionId, vaultId],
    queryFn: () => sessionId ? apiRequest("GET", withVault(`/api/chat/sessions/${sessionId}`, vaultParam)).then(r => r.json()) : null,
    enabled: !!sessionId && !!vaultId,
  });

  useEffect(() => {
    if (session?.events) setEvents(session.events);
  }, [session]);

  // WebSocket connection
  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", sessionId }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "status") {
        setStatus(data.content === "thinking" ? "thinking" : data.content === "done" ? "idle" : "idle");
        if (data.content === "done") {
          queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
          // AI may have created notes/tasks via tools — invalidate so other pages refresh
          queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notes/folders"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }
      } else {
        setEvents(prev => [...prev, data]);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    const images = uploadedImages.length > 0 ? uploadedImages : undefined;
    if ((!msg && !images) || status === "thinking") return;
    if (isUploading) return; // Wait for uploads to finish
    setInput("");
    clearImages();

    const payload: any = { type: "chat", message: msg, vaultId };
    if (images) payload.images = images;

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      try {
        const res = await apiRequest("POST", withVault("/api/chat/sessions", vaultParam), { title: "New Chat" });
        const session = await res.json();
        targetSessionId = session.id;
        setLocation(`/chat/${session.id}`);
        // Reconnect ws will happen via useEffect
        setTimeout(() => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ...payload, sessionId: targetSessionId }));
          }
        }, 500);
        return;
      } catch { return; }
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus("thinking");
      ws.send(JSON.stringify({ ...payload, sessionId: targetSessionId }));
    }
  }, [input, sessionId, status, setLocation, uploadedImages, isUploading, clearImages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleToolExpand = (id: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewChat = async () => {
    try {
      const res = await apiRequest("POST", withVault("/api/chat/sessions", vaultParam), { title: "New Chat" });
      const session = await res.json();
      setEvents([]);
      setStatus("idle");
      setLocation(`/chat/${session.id}`);
    } catch {}
  };

  const renderEvent = (event: ChatEvent, idx: number) => {
    const isUser = event.metadata?.role === "user";

    switch (event.type) {
      case "message":
        if (isUser) {
          const userImages: string[] = event.metadata?.images || [];
          // Separate text from image markdown
          const textContent = event.content.replace(/!\[image\]\([^)]+\)\n?/g, "").trim();
          return (
            <div key={event.id || idx} className="flex justify-end mb-4">
              <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5">
                {userImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {userImages.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt="pasted"
                        className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                        data-testid={`img-user-${idx}-${i}`}
                      />
                    ))}
                  </div>
                )}
                {textContent && <p className="text-sm whitespace-pre-wrap">{textContent}</p>}
              </div>
            </div>
          );
        }
        return (
          <div key={event.id || idx} className="flex mb-4 gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-sm prose prose-sm dark:prose-invert max-w-none [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:text-xs"
                dangerouslySetInnerHTML={{ __html: marked.parse(event.content) as string }}
              />
            </div>
          </div>
        );

      case "thought":
        return (
          <div key={event.id || idx} className="flex mb-2 gap-3 items-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5">
              <Brain className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground italic">{event.content}</p>
            </div>
          </div>
        );

      case "tool_call":
        try {
          const data = JSON.parse(event.content);
          const isExpanded = expandedTools.has(event.id || String(idx));
          return (
            <div key={event.id || idx} className="flex mb-1 gap-3 items-start">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center mt-0.5">
                <Wrench className="w-3.5 h-3.5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => toggleToolExpand(event.id || String(idx))}
                  className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                    {data.name}
                  </Badge>
                </button>
                {isExpanded && (
                  <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 mt-1 overflow-x-auto">
                    {JSON.stringify(data.args, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        } catch {
          return null;
        }

      case "tool_result":
        const isExpResult = expandedTools.has(event.id || String(idx));
        return (
          <div key={event.id || idx} className="flex mb-2 gap-3 items-start">
            <div className="w-7" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => toggleToolExpand(event.id || String(idx))}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpResult ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span>Result</span>
              </button>
              {isExpResult && (
                <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-32">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(event.content), null, 2); }
                    catch { return event.content; }
                  })()}
                </pre>
              )}
            </div>
          </div>
        );

      case "error":
        return (
          <div key={event.id || idx} className="flex mb-3 gap-3 items-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center mt-0.5">
              <AlertCircle className="w-3.5 h-3.5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-destructive">{event.content}</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Empty state (no session selected)
  if (!sessionId && location !== "/") {
    return (
      <div className="flex-1 flex flex-col">
        <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <span className="text-sm font-medium">Chat</span>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Brain className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Cortex</h2>
            <p className="text-sm text-muted-foreground mb-6">Your personal AI operating system. Ask me anything, create notes, manage tasks, or browse the web.</p>
            <Button onClick={handleNewChat} className="gap-2" data-testid="button-start-chat">
              <Plus className="w-4 h-4" /> Start a conversation
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate">
          {session?.title || "New Chat"}
        </span>
        {status === "thinking" && (
          <Badge variant="secondary" className="text-[10px] gap-1 ml-auto">
            <Loader2 className="w-3 h-3 animate-spin" />
            Thinking
          </Badge>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {events.length === 0 && (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Send a message to start</p>
              </div>
            </div>
          )}
          {events.map((e, i) => renderEvent(e, i))}
          {status === "thinking" && events.length > 0 && (
            <div className="flex mb-3 gap-3 items-center">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              </div>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div
        className={`border-t border-border/50 bg-background px-4 py-3 shrink-0 transition-colors ${isDragging ? "bg-primary/5 border-primary/30" : ""}`}
        onDrop={(e) => { handleDrop(e); setIsDragging(false); }}
        onDragOver={(e) => { handleDragOver(e); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
      >
        <div className="max-w-3xl mx-auto">
          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingImages.map(img => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.preview}
                    alt="preview"
                    className={`h-16 w-16 rounded-lg object-cover border border-border/50 ${img.uploading ? "opacity-50" : ""} ${img.error ? "border-destructive" : ""}`}
                  />
                  {img.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    data-testid={`button-remove-image-${img.id}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative flex items-end gap-2 bg-muted/50 rounded-xl border border-border/50 p-2 focus-within:border-primary/50 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) Array.from(files).forEach(f => addImage(f));
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-attach-image"
              title="Attach image"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </Button>
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isDragging ? "Drop image here..." : "Ask anything... (paste or drop images)"}
              className="min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm p-1"
              rows={1}
              data-testid="input-chat"
            />
            <Button
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg"
              onClick={handleSend}
              disabled={(!input.trim() && !hasImages) || status === "thinking" || isUploading}
              data-testid="button-send"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
            Cortex can make mistakes. Paste or drop images to analyze them.
          </p>
        </div>
      </div>
    </div>
  );
}
