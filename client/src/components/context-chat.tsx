import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Brain,
  Wrench,
  Sparkles,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  X,
  FileText,
  CheckSquare,
  Paperclip,
  Plus,
  ArrowUp,
  ListOrdered,
  Check,
} from "lucide-react";
import { marked } from "@/lib/marked-config";
import { useImagePaste } from "@/hooks/use-image-paste";
import { AttachMenu } from "@/components/attach-menu";

interface ChatEvent {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface ContextItem {
  type: "note" | "task" | "text" | "file";
  title: string;
  content: string;
  id?: string;
  mimeType?: string;
}

interface ContextChatProps {
  context: ContextItem[];
  open: boolean;
  onClose: () => void;
  placeholder?: string;
  /** Dynamic width in px — if undefined, defaults to 350 */
  width?: number;
  style?: React.CSSProperties;
  /** Callback to remove a context item by id */
  onRemoveContext?: (id: string) => void;
  /** All available items for @mention autocomplete */
  availableItems?: ContextItem[];
  /** Callback when user selects an item from @mention */
  onAddContext?: (item: ContextItem) => void;
}

export function ContextChat({ context, open, onClose, placeholder, width, style, onRemoveContext, availableItems, onAddContext }: ContextChatProps) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking">("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessageRef = useRef<string | null>(null);
  const hasLiveEventsRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { vaultParam, vaultId } = useVault();
  const {
    pendingImages, uploadedImages, hasImages, allUploaded, isUploading,
    addImage, removeImage, clearImages, handlePaste, handleDrop, handleDragOver,
  } = useImagePaste(vaultParam);

  // Reset when context changes significantly
  const contextKey = context.map(c => c.id || c.title).join(",");
  const prevContextKey = useRef(contextKey);
  useEffect(() => {
    if (prevContextKey.current !== contextKey) {
      // Context changed — start fresh session
      setEvents([]);
      setSessionId(null);
      setStatus("idle");
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      prevContextKey.current = contextKey;
    }
  }, [contextKey]);

  // Connect WebSocket when session exists
  useEffect(() => {
    if (!sessionId || !open) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", sessionId }));
      // If there's a pending message (from creating a new session), send it now
      const pending = pendingMessageRef.current;
      if (pending) {
        pendingMessageRef.current = null;
        setStatus("thinking");
        ws.send(pending);
      }
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "status") {
        setStatus(data.content === "thinking" ? "thinking" : "idle");
        if (data.content === "done") {
          queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notes/folders"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          hasLiveEventsRef.current = false;
        }
      } else {
        hasLiveEventsRef.current = true;
        setEvents(prev => [...prev, data]);
      }
    };

    ws.onerror = () => {
      if (pendingMessageRef.current) {
        pendingMessageRef.current = null;
        setStatus("idle");
      }
    };

    ws.onclose = () => { wsRef.current = null; };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, open]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Compute filtered @mention suggestions
  const contextIds = new Set(context.map(c => c.id));
  const mentionSuggestions = (availableItems || []).filter(item => {
    if (contextIds.has(item.id)) return false;
    if (mentionQuery === null) return false;
    if (mentionQuery === "") return true;
    return item.title.toLowerCase().includes(mentionQuery.toLowerCase());
  }).slice(0, 8);

  // Reset mention index when suggestions change
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    const images = uploadedImages.length > 0 ? uploadedImages : undefined;
    if ((!msg && !images) || status === "thinking") return;
    if (isUploading) return;
    setInput("");
    clearImages();
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = "auto";

    const payload: any = { type: "chat", message: msg, context, vaultId };
    if (images) payload.images = images;

    let sid = sessionId;
    if (!sid) {
      try {
        const contextTitle = context.length > 0
          ? `About: ${context.map(c => c.title).join(", ").slice(0, 50)}`
          : "Context Chat";
        const res = await apiRequest("POST", withVault("/api/chat/sessions", vaultParam), { title: contextTitle });
        const session = await res.json();
        sid = session.id;
        // Queue the message to be sent once the WebSocket connects
        pendingMessageRef.current = JSON.stringify({ ...payload, sessionId: sid });
        setStatus("thinking");
        setSessionId(session.id);
        return;
      } catch { return; }
    }

    const message = JSON.stringify({ ...payload, sessionId: sid });
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus("thinking");
      ws.send(message);
    } else {
      // WebSocket not yet open — queue the message
      pendingMessageRef.current = message;
      setStatus("thinking");
    }
  }, [input, sessionId, status, context, vaultId, vaultParam, uploadedImages, isUploading, clearImages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    // Detect @mention
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([^@]*)$/);
    if (atMatch && availableItems && availableItems.length > 0) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
    }
  };

  const selectMention = useCallback((item: ContextItem) => {
    // Remove the @query text from input
    const ta = inputRef.current;
    if (ta) {
      const cursorPos = ta.selectionStart;
      const textBefore = input.slice(0, cursorPos);
      const atIdx = textBefore.lastIndexOf("@");
      if (atIdx >= 0) {
        const newInput = input.slice(0, atIdx) + input.slice(cursorPos);
        setInput(newInput);
      }
    }
    setMentionQuery(null);
    onAddContext?.(item);
    setTimeout(() => inputRef.current?.focus(), 10);
  }, [input, onAddContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle @mention navigation
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onClose();
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

  const currentActivity = useMemo(() => {
    if (status !== "thinking") return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "tool_call") {
        try { return `Using ${JSON.parse(e.content).name}`; } catch {}
      }
      if (e.type === "tool_result") return "Processing result...";
      if (e.type === "plan") return "Planning...";
      if (e.type === "thought") {
        if (e.metadata?.kind === "intent") return "Understanding...";
        const t = e.content;
        return t.length > 40 ? t.slice(0, 40) + "…" : t;
      }
    }
    return "Thinking...";
  }, [events, status]);

  const renderEvent = (event: ChatEvent, idx: number) => {
    const isUser = event.metadata?.role === "user";

    switch (event.type) {
      case "message":
        if (isUser) {
          const userImages: string[] = event.metadata?.images || [];
          const textContent = event.content.replace(/!\[image\]\([^)]+\)\n?/g, "").trim();
          return (
            <div key={event.id || idx} className="flex justify-end mb-3">
              <div className="max-w-[85%] bg-muted/40 border border-border/30 text-foreground rounded-2xl rounded-br-md px-3 py-2">
                {userImages.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {userImages.map((url, i) => (
                      <img key={i} src={url} alt="pasted" className="max-w-[120px] max-h-[90px] rounded-md object-cover" />
                    ))}
                  </div>
                )}
                {textContent && <p className="text-xs whitespace-pre-wrap">{textContent}</p>}
              </div>
            </div>
          );
        }
        return (
          <div key={event.id || idx} className="flex mb-3 gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted/60 flex items-center justify-center mt-0.5">
              <Sparkles className="w-3 h-3 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-xs prose prose-xs dark:prose-invert max-w-none [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_code]:text-[10px]"
                dangerouslySetInnerHTML={{ __html: marked.parse(event.content) as string }}
              />
            </div>
          </div>
        );

      case "thought":
        if (event.metadata?.kind === "intent") {
          return (
            <div key={event.id || idx} className="mb-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
              <div className="flex items-start gap-2">
                <Brain className="w-3.5 h-3.5 text-primary/50 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[9px] font-semibold text-primary/60 uppercase tracking-wider mb-0.5">Understanding</p>
                  <p className="text-xs text-foreground/80 leading-snug">{event.content}</p>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div key={event.id || idx} className="flex mb-1.5 gap-2 items-start">
            <div className="flex-shrink-0 w-6 flex justify-center pt-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            </div>
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{event.content}</p>
          </div>
        );

      case "plan": {
        const steps: string[] = event.metadata?.steps || event.content.split("\n").filter(Boolean);
        const isCollapsed = expandedTools.has(`collapsed-${event.id || idx}`);
        return (
          <div key={event.id || idx} className="mb-2 rounded-lg border border-border/60 overflow-hidden">
            <button
              onClick={() => toggleToolExpand(`collapsed-${event.id || idx}`)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left border-b border-border/40"
            >
              <ListOrdered className="w-3 h-3 text-foreground/50 shrink-0" />
              <span className="text-[10px] font-semibold text-foreground/70">{event.metadata?.revised ? "Revised Plan" : "Plan"}</span>
              <span className="text-[10px] text-muted-foreground ml-1">— {steps.length} steps</span>
              <span className="ml-auto">{isCollapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}</span>
            </button>
            {!isCollapsed && (
              <ol className="px-3 py-2 space-y-1.5">
                {steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground mt-0.5">{i + 1}</span>
                    <span className="text-xs text-foreground/75 leading-snug">{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      }

      case "tool_call": {
        try {
          const data = JSON.parse(event.content);
          const args = data.args || {};
          const PRIORITY_KEYS = ["url", "query", "title", "name", "path", "id", "keyword"];
          const inlineKey = PRIORITY_KEYS.find(k => args[k]) || Object.keys(args)[0];
          const inlineVal = inlineKey ? String(args[inlineKey]).slice(0, 55) : "";
          return (
            <div key={event.id || idx} className="mb-1 flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/20 border border-border/30 text-[10px] text-muted-foreground">
              <Wrench className="w-2.5 h-2.5 shrink-0 opacity-50" />
              <code className="font-mono font-medium text-foreground/70">{data.name}</code>
              {inlineVal && <span className="opacity-50 truncate">{inlineVal}</span>}
            </div>
          );
        } catch { return null; }
      }

      case "tool_result": {
        const isExp = expandedTools.has(event.id || String(idx));
        const firstLine = event.content.split("\n").find(l => l.trim()) || event.content;
        const preview = firstLine.slice(0, 70) + (event.content.length > 70 ? "…" : "");
        return (
          <div key={event.id || idx} className="mb-1">
            <button
              onClick={() => toggleToolExpand(event.id || String(idx))}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/10 border border-border/20 text-[10px] text-muted-foreground hover:bg-muted/20 transition-colors w-full text-left"
            >
              <Check className="w-2.5 h-2.5 text-green-500/60 shrink-0" />
              <span className="truncate opacity-60">{preview}</span>
              {event.content.length > 70 && <span className="ml-auto shrink-0 opacity-40">{isExp ? "▲" : "▼"}</span>}
            </button>
            {isExp && (
              <pre className="text-[10px] text-muted-foreground bg-muted/10 px-2.5 py-1.5 overflow-x-auto max-h-32 rounded-b border border-t-0 border-border/20 leading-relaxed">
                {event.content}
              </pre>
            )}
          </div>
        );
      }

      case "error":
        return (
          <div key={event.id || idx} className="flex mb-2 gap-2 items-center">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-3 h-3 text-destructive" />
            </div>
            <p className="text-[10px] text-destructive leading-none">{event.content}</p>
          </div>
        );

      default:
        return null;
    }
  };

  if (!open) return null;

  return (
    <div className="border-l border-border/50 flex flex-col bg-background shrink-0 h-full" style={{ width: width ?? 350, ...style }} data-testid="context-chat-panel">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border/50 shrink-0">
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">AI Chat</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} data-testid="button-close-chat">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Context badges */}
      {context.length > 0 && (
        <div className="px-3 py-2 border-b border-border/50 flex flex-wrap gap-1">
          {context.map((item, i) => (
            <Badge key={item.id || i} variant="secondary" className="text-[9px] px-1.5 py-0 h-4 gap-1 group/badge">
              {item.type === "note" ? <FileText className="w-2.5 h-2.5" /> : item.type === "file" ? <Paperclip className="w-2.5 h-2.5" /> : <CheckSquare className="w-2.5 h-2.5" />}
              <span className="truncate max-w-[150px] inline-block align-bottom" title={item.title}>{item.title}</span>
              {onRemoveContext && item.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveContext(item.id!); }}
                  className="ml-0.5 opacity-0 group-hover/badge:opacity-100 transition-opacity hover:text-destructive"
                  title="Remove from context"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-8 h-8 rounded-full bg-muted/40 flex items-center justify-center mb-2">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground/40" />
            </div>
            <p className="text-xs text-muted-foreground/40">
              {context.length > 0
                ? `${context.length} item${context.length > 1 ? "s" : ""} in context`
                : "No context selected"}
            </p>
            <p className="text-[10px] text-muted-foreground/25 mt-1">
              {context.length > 0 ? "Ask a question to get started" : "Select items to chat about them"}
            </p>
          </div>
        )}
        {events.map((e, i) => renderEvent(e, i))}
        {status === "thinking" && (
          <div className="flex mb-2 gap-2 items-center">
            <div className="flex-shrink-0 w-6 flex justify-center">
              <Loader2 className="w-3 h-3 text-muted-foreground/60 animate-spin" />
            </div>
            <span className="text-[10px] text-muted-foreground/70 leading-none">{currentActivity}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="border-t border-border/50 p-2 shrink-0"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Image previews */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-0.5">
            {pendingImages.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={img.preview}
                  alt="preview"
                  className={`h-10 w-10 rounded object-cover border border-border/50 ${img.uploading ? "opacity-50" : ""}`}
                />
                {img.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  </div>
                )}
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2 h-2" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative bg-muted/30 rounded-xl border border-border/40 transition-colors">
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
          <div className="relative">
            {/* @mention dropdown */}
            {mentionQuery !== null && mentionSuggestions.length > 0 && (
              <div
                ref={mentionRef}
                className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto"
              >
                {mentionSuggestions.map((item, i) => (
                  <button
                    key={item.id || i}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      i === mentionIndex ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50"
                    }`}
                    onMouseDown={(e) => { e.preventDefault(); selectMention(item); }}
                    onMouseEnter={() => setMentionIndex(i)}
                  >
                    {item.type === "note" ? <FileText className="w-3 h-3 shrink-0" /> : item.type === "file" ? <Paperclip className="w-3 h-3 shrink-0" /> : <CheckSquare className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            )}
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e);
                // Auto-resize
                const ta = e.target;
                ta.style.height = "auto";
                ta.style.height = Math.min(ta.scrollHeight, 300) + "px";
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder || (availableItems ? "Type @ to add notes..." : "Ask anything...")}
              className="min-h-[32px] max-h-[300px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-xs px-3 pt-2.5 pb-0 leading-relaxed overflow-y-auto"
              rows={1}
              data-testid="input-context-chat"
            />
          </div>
          <div className="flex items-center justify-between px-2 py-1.5">
            <AttachMenu
              onUploadFile={() => fileInputRef.current?.click()}
              onAttachItem={onAddContext ? (item) => {
                onAddContext({ type: item.type as "note" | "task", title: item.title, content: "", id: item.id });
              } : undefined}
              size="sm"
            />
            <Button
              size="icon"
              className="h-5 w-5 rounded-full bg-foreground/80 hover:bg-foreground text-background disabled:opacity-30 disabled:bg-muted-foreground/30"
              onClick={handleSend}
              disabled={(!input.trim() && !hasImages) || status === "thinking" || isUploading}
              data-testid="button-context-send"
            >
              <ArrowUp className="w-2.5 h-2.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
