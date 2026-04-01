import { useState, useMemo } from "react";
import { Activity, X, ChevronLeft, ChevronRight, Brain, Wrench, Eye, CheckCircle2, XCircle, Zap } from "lucide-react";

interface ChatEvent {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

interface Turn {
  index: number;
  thoughts: string[];
  toolName: string;
  toolArgs: Record<string, any>;
  result: string;
  hasError: boolean;
}

interface Run {
  userMessage: string;
  intent?: string;
  turns: Turn[];
  finalResponse?: string;
  isComplete: boolean;
}

// ── Parse events into structured runs ────────────────────────────────────────

function parseRuns(events: ChatEvent[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let pendingThoughts: string[] = [];

  for (const e of events) {
    if (e.type === "message" && e.metadata?.role === "user") {
      current = {
        userMessage: e.content.replace(/!\[image\]\([^)]+\)\n?/g, "").trim() || "(image)",
        intent: undefined,
        turns: [],
        finalResponse: undefined,
        isComplete: false,
      };
      runs.push(current);
      pendingThoughts = [];

    } else if (e.type === "thought") {
      if (e.metadata?.kind === "intent") {
        if (current) current.intent = e.content;
      } else {
        // Skip purely mechanical messages
        const skip = ["Reading your request...", "Thinking...", "Processing result..."];
        if (!skip.some(s => e.content.startsWith(s))) {
          pendingThoughts.push(e.content);
        }
      }

    } else if (e.type === "tool_call") {
      if (!current) continue;
      try {
        const data = JSON.parse(e.content);
        current.turns.push({
          index: current.turns.length + 1,
          thoughts: [...pendingThoughts],
          toolName: data.name || "unknown",
          toolArgs: data.args || {},
          result: "",
          hasError: false,
        });
        pendingThoughts = [];
      } catch {}

    } else if (e.type === "tool_result") {
      if (!current) continue;
      const last = current.turns[current.turns.length - 1];
      if (last && !last.result) {
        last.result = e.content;
        last.hasError = e.content.includes('"error"');
      }

    } else if (e.type === "message" && e.metadata?.role === "assistant") {
      if (current) {
        current.finalResponse = e.content;
        current.isComplete = true;
      }
    }
  }

  return runs.filter(r => r.userMessage.length > 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, n: number) {
  const single = s.replace(/\n+/g, " ").trim();
  return single.length > n ? single.slice(0, n) + "…" : single;
}

/** Pick the most descriptive single argument value to show inline. */
function primaryArg(args: Record<string, any>): string {
  const PRIORITY = ["url", "query", "title", "name", "path", "id", "keyword", "content"];
  const key = PRIORITY.find(k => args[k]) ?? Object.keys(args)[0];
  if (!key) return "";
  return truncate(String(args[key]), 48);
}

function resultSummary(result: string, hasError: boolean): string {
  if (hasError) {
    try {
      const parsed = JSON.parse(result);
      return parsed.error ? truncate(parsed.error, 60) : "Error";
    } catch { return "Error"; }
  }
  const len = result.length;
  const line = result.split("\n").find(l => l.trim()) || result;
  const snippet = truncate(line, 52);
  return len > 200 ? `${snippet}  (${(len / 1000).toFixed(1)}k chars)` : snippet;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TurnRow({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const arg = primaryArg(turn.toolArgs);
  const obs = resultSummary(turn.result, turn.hasError);

  return (
    <div className="group">
      {/* Turn header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left rounded-md"
      >
        {/* Turn number */}
        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-muted/60 border border-border/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
          {turn.index}
        </span>

        <div className="flex-1 min-w-0 space-y-1">
          {/* Think */}
          {turn.thoughts.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 text-[9px] font-semibold tracking-widest text-violet-500/70 uppercase w-10">think</span>
              <span className="text-xs text-foreground/60 leading-snug">{truncate(turn.thoughts[turn.thoughts.length - 1], 80)}</span>
            </div>
          )}
          {/* Act */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[9px] font-semibold tracking-widest text-amber-500/80 uppercase w-10">act</span>
            <span className="flex items-center gap-1.5 min-w-0">
              <code className="text-[11px] font-mono font-semibold text-foreground/80 bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
                {turn.toolName}
              </code>
              {arg && <span className="text-xs text-muted-foreground truncate">{arg}</span>}
            </span>
          </div>
          {/* Observe */}
          <div className="flex items-start gap-2">
            <span className="shrink-0 mt-0.5 text-[9px] font-semibold tracking-widest text-emerald-500/80 uppercase w-10">obs</span>
            <span className="flex items-center gap-1.5 min-w-0">
              {turn.hasError
                ? <XCircle className="w-3 h-3 text-destructive shrink-0" />
                : <CheckCircle2 className="w-3 h-3 text-emerald-500/70 shrink-0" />
              }
              <span className={`text-xs leading-snug truncate ${turn.hasError ? "text-destructive/80" : "text-muted-foreground"}`}>
                {obs}
              </span>
            </span>
          </div>
        </div>

        <ChevronRight className={`w-3 h-3 text-muted-foreground/40 shrink-0 mt-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mx-3 mb-2 rounded-md bg-muted/20 border border-border/40 overflow-hidden">
          {turn.thoughts.map((t, i) => (
            <div key={i} className="px-3 py-2 border-b border-border/30 last:border-b-0">
              <p className="text-[10px] font-semibold text-violet-500/60 uppercase tracking-widest mb-1">
                {turn.thoughts.length > 1 ? `Thought ${i + 1}` : "Thought"}
              </p>
              <p className="text-xs text-foreground/70 leading-relaxed whitespace-pre-wrap">{t}</p>
            </div>
          ))}
          <div className="px-3 py-2 border-b border-border/30">
            <p className="text-[10px] font-semibold text-amber-500/70 uppercase tracking-widest mb-1">Tool call</p>
            <code className="text-xs text-foreground/70 font-mono leading-relaxed whitespace-pre-wrap break-all">
              {turn.toolName}({Object.entries(turn.toolArgs).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})
            </code>
          </div>
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold text-emerald-500/60 uppercase tracking-widest mb-1">Result</p>
            <pre className="text-xs text-foreground/60 font-mono leading-relaxed whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {turn.result || "—"}
            </pre>
          </div>
        </div>
      )}

      {/* Connector line between turns */}
      {!isLast && (
        <div className="ml-5 pl-2.5 h-2 border-l border-dashed border-border/40" />
      )}
    </div>
  );
}

function RunView({ run }: { run: Run }) {
  return (
    <div className="space-y-1">
      {/* Intent */}
      {run.intent && (
        <div className="flex items-start gap-2 px-3 py-2 mb-1 rounded-md bg-primary/5 border border-primary/15">
          <Brain className="w-3.5 h-3.5 text-primary/50 shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/70 leading-snug">{run.intent}</p>
        </div>
      )}

      {/* Turns */}
      {run.turns.length > 0 ? (
        <div className="rounded-md border border-border/50 overflow-hidden">
          {run.turns.map((turn, i) => (
            <TurnRow key={i} turn={turn} isLast={i === run.turns.length - 1} />
          ))}
        </div>
      ) : (
        /* No tool calls — show the direct response */
        <div className="rounded-md border border-border/50 overflow-hidden">
          <div className="flex items-start gap-3 px-3 py-2.5">
            <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-muted/60 border border-border/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground">1</span>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[9px] font-semibold tracking-widest text-emerald-500/80 uppercase w-10">obs</span>
                <span className="text-xs text-muted-foreground truncate">
                  {run.finalResponse
                    ? truncate(run.finalResponse.split("\n").find(l => l.trim()) || run.finalResponse, 72)
                    : run.isComplete ? "Response sent" : "Waiting…"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 px-1 pt-1">
        {run.isComplete ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-500/60 shrink-0" />
        ) : (
          <Zap className="w-3 h-3 text-amber-500/60 shrink-0 animate-pulse" />
        )}
        <span className="text-[11px] text-muted-foreground">
          {run.isComplete ? "Completed" : "In progress"}
          {run.turns.length > 0 && ` · ${run.turns.length} tool call${run.turns.length !== 1 ? "s" : ""}`}
          {run.finalResponse && ` · ${(run.finalResponse.length / 1000).toFixed(1)}k chars`}
        </span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LoopDebugger({ events }: { events: ChatEvent[] }) {
  const [open, setOpen] = useState(false);
  const [runIdx, setRunIdx] = useState(0);

  const runs = useMemo(() => parseRuns(events), [events]);

  const latestIdx = Math.max(0, runs.length - 1);
  const activeIdx = Math.min(runIdx === 0 && latestIdx > 0 ? latestIdx : runIdx, latestIdx);
  const totalTurns = runs.reduce((s, r) => s + r.turns.length, 0);
  const hasRuns = runs.length > 0;
  const run = runs[activeIdx];

  return (
    <>
      {/* Trigger button — always visible, dimmed when no data yet */}
      <button
        onClick={() => { if (hasRuns) { setOpen(true); setRunIdx(latestIdx); } }}
        title={hasRuns ? "Loop inspector" : "Loop inspector (no tool calls yet)"}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors
          ${hasRuns
            ? "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-border/40 hover:border-border/70 cursor-pointer"
            : "text-muted-foreground/30 border-border/20 cursor-default"
          }`}
      >
        <Activity className="w-3 h-3" />
        <span>{hasRuns ? totalTurns : "–"}</span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        >
          {/* Panel */}
          <div
            className="relative w-full max-w-[580px] max-h-[75vh] flex flex-col rounded-xl border border-border/70 bg-background shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50 shrink-0">
              <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold">Loop Inspector</span>

              {/* Run navigation */}
              {runs.length > 1 && (
                <div className="flex items-center gap-1 ml-auto mr-2">
                  <button
                    onClick={() => setRunIdx(i => Math.max(0, i - 1))}
                    disabled={activeIdx === 0}
                    className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-muted-foreground px-1 min-w-[60px] text-center">
                    Run {activeIdx + 1} / {runs.length}
                  </span>
                  <button
                    onClick={() => setRunIdx(i => Math.min(runs.length - 1, i + 1))}
                    disabled={activeIdx === runs.length - 1}
                    className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {runs.length === 1 && <span className="text-xs text-muted-foreground ml-auto mr-2">1 run</span>}

              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* User message */}
            <div className="px-4 py-2.5 border-b border-border/30 bg-muted/10 shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">Prompt</p>
              <p className="text-xs text-foreground/80 leading-snug line-clamp-2">{run.userMessage}</p>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <RunView run={run} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
