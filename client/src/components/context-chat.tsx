import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
} from "lucide-react";
import { marked } from "marked";

interface ChatEvent {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface ContextItem {
  type: "note" | "task" | "text";
  title: string;
  content: string;
  id?: string;
}

interface ContextChatProps {
  context: ContextItem[];
  open: boolean;
  onClose: () => void;
  placeholder?: string;
}

export function ContextChat({ context, open, onClose, placeholder }: ContextChatProps) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking">("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

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
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "status") {
        setStatus(data.content === "thinking" ? "thinking" : "idle");
        if (data.content === "done") {
          queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }
      } else {
        setEvents(prev => [...prev, data]);
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

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || status === "thinking") return;
    setInput("");

    let sid = sessionId;
    if (!sid) {
      try {
        const contextTitle = context.length > 0
          ? `About: ${context.map(c => c.title).join(", ").slice(0, 50)}`
          : "Context Chat";
        const res = await apiRequest("POST", "/api/chat/sessions", { title: contextTitle });
        const session = await res.json();
        sid = session.id;
        setSessionId(session.id);
        // Wait for WS connection
        setTimeout(() => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            setStatus("thinking");
            ws.send(JSON.stringify({
              type: "chat",
              sessionId: sid,
              message: msg,
              context: context,
            }));
          }
        }, 600);
        return;
      } catch { return; }
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus("thinking");
      ws.send(JSON.stringify({
        type: "chat",
        sessionId: sid,
        message: msg,
        context: context,
      }));
    }
  }, [input, sessionId, status, context]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  const renderEvent = (event: ChatEvent, idx: number) => {
    const isUser = event.metadata?.role === "user";

    switch (event.type) {
      case "message":
        if (isUser) {
          return (
            <div key={event.id || idx} className="flex justify-end mb-3">
              <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-3 py-2">
                <p className="text-xs whitespace-pre-wrap">{event.content}</p>
              </div>
            </div>
          );
        }
        return (
          <div key={event.id || idx} className="flex mb-3 gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <Sparkles className="w-3 h-3 text-primary" />
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
        return (
          <div key={event.id || idx} className="flex mb-1.5 gap-2 items-start">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5">
              <Brain className="w-3 h-3 text-amber-500" />
            </div>
            <p className="text-[10px] text-muted-foreground italic pt-1">{event.content}</p>
          </div>
        );

      case "tool_call":
        try {
          const data = JSON.parse(event.content);
          const isExpanded = expandedTools.has(event.id || String(idx));
          return (
            <div key={event.id || idx} className="flex mb-1 gap-2 items-start">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center mt-0.5">
                <Wrench className="w-3 h-3 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => toggleToolExpand(event.id || String(idx))}
                  className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400"
                >
                  {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-mono">{data.name}</Badge>
                </button>
                {isExpanded && (
                  <pre className="text-[9px] text-muted-foreground bg-muted/50 rounded p-1.5 mt-0.5 overflow-x-auto">
                    {JSON.stringify(data.args, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        } catch { return null; }

      case "tool_result":
        const isExp = expandedTools.has(event.id || String(idx));
        return (
          <div key={event.id || idx} className="flex mb-1.5 gap-2 items-start">
            <div className="w-6" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => toggleToolExpand(event.id || String(idx))}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {isExp ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                <span>Result</span>
              </button>
              {isExp && (
                <pre className="text-[9px] text-muted-foreground bg-muted/50 rounded p-1.5 mt-0.5 overflow-x-auto max-h-24">
                  {(() => { try { return JSON.stringify(JSON.parse(event.content), null, 2); } catch { return event.content; } })()}
                </pre>
              )}
            </div>
          </div>
        );

      case "error":
        return (
          <div key={event.id || idx} className="flex mb-2 gap-2 items-start">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center mt-0.5">
              <AlertCircle className="w-3 h-3 text-destructive" />
            </div>
            <p className="text-[10px] text-destructive pt-1">{event.content}</p>
          </div>
        );

      default:
        return null;
    }
  };

  if (!open) return null;

  return (
    <div className="w-80 border-l border-border/50 flex flex-col bg-background shrink-0 h-full" data-testid="context-chat-panel">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border/50 shrink-0">
        <MessageSquare className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium flex-1">AI Chat</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} data-testid="button-close-chat">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Context badges */}
      {context.length > 0 && (
        <div className="px-3 py-2 border-b border-border/50 flex flex-wrap gap-1">
          {context.map((item, i) => (
            <Badge key={i} variant="secondary" className="text-[9px] px-1.5 py-0 h-4 gap-1">
              {item.type === "note" ? <FileText className="w-2.5 h-2.5" /> : <CheckSquare className="w-2.5 h-2.5" />}
              {item.title.slice(0, 25)}{item.title.length > 25 ? "..." : ""}
            </Badge>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <p className="text-[10px] text-muted-foreground max-w-[200px]">
              {context.length > 0
                ? `Ask about ${context.length === 1 ? `"${context[0].title}"` : `these ${context.length} items`}`
                : "Ask anything..."}
            </p>
          </div>
        )}
        {events.map((e, i) => renderEvent(e, i))}
        {status === "thinking" && events.length > 0 && (
          <div className="flex mb-2 gap-2 items-center">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-3 h-3 text-primary animate-spin" />
            </div>
            <div className="flex gap-1">
              <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-2 shrink-0">
        <div className="relative flex items-end gap-1.5 bg-muted/50 rounded-lg border border-border/50 p-1.5 focus-within:border-primary/50 transition-colors">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "Ask about this..."}
            className="min-h-[32px] max-h-[80px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-xs p-0.5"
            rows={1}
            data-testid="input-context-chat"
          />
          <Button
            size="icon"
            className="shrink-0 h-6 w-6 rounded-md"
            onClick={handleSend}
            disabled={!input.trim() || status === "thinking"}
            data-testid="button-context-send"
          >
            <Send className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
