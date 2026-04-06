import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { useLocation, useRoute } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Zap, Cpu, AlertTriangle, RotateCcw, Layers } from "lucide-react";

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  grok: "Grok",
  google: "Gemini",
  none: "No Provider",
};

// Default model per provider — must match PROVIDER_DEFAULT_MODELS in agent-llm.ts
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4.1",
  anthropic: "claude-opus-4-5",
  grok: "grok-4",
  google: "gemini-2.5-flash",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Approximate cost per 1M tokens (input, output) by provider
const COST_PER_M: Record<string, { input: number; output: number }> = {
  openai:    { input: 2.50, output: 10.00 },  // gpt-4o
  anthropic: { input: 3.00, output: 15.00 },  // claude sonnet 4
  grok:      { input: 3.00, output: 15.00 },  // grok-3
  google:    { input: 0.10, output: 0.40 },   // gemini-2.0-flash
};

function estimateCost(provider: string, inputTokens: number, outputTokens: number): string {
  const rates = COST_PER_M[provider];
  if (!rates) return "";
  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  if (cost < 0.01) return "<$0.01";
  return `~$${cost.toFixed(2)}`;
}

// Context window sizes in tokens by provider
const CONTEXT_WINDOW: Record<string, number> = {
  anthropic: 200_000,
  openai:    128_000,
  grok:      131_072,
  google:  1_000_000,
};

export function StatusBar() {
  const queryClient = useQueryClient();
  const { vaultParam } = useVault();
  const [, setLocation] = useLocation();
  const [, chatParams] = useRoute("/chat/:id");
  const currentSessionId = chatParams?.id ?? null;

  const { data: stats } = useQuery<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
  }>({
    queryKey: ["/api/stats", vaultParam],
    queryFn: () =>
      apiRequest("GET", withVault("/api/stats", vaultParam)).then((r) =>
        r.json()
      ),
    refetchInterval: 5000,
  });

  const { data: info } = useQuery<{
    provider: string;
    hasApiKey: boolean;
    keyStatus: Record<string, { set: boolean; source: string }>;
    version: string;
  }>({
    queryKey: ["/api/info"],
    queryFn: () => apiRequest("GET", "/api/info").then((r) => r.json()),
  });

  const { data: config } = useQuery<any>({
    queryKey: ["/api/config"],
    queryFn: () => apiRequest("GET", "/api/config").then((r) => r.json()),
  });

  // Fetch current chat session to show context window fill
  const { data: currentSession } = useQuery<{ contextTokens?: number }>({
    queryKey: ["/api/chat/sessions", currentSessionId, vaultParam],
    queryFn: () => apiRequest("GET", withVault(`/api/chat/sessions/${currentSessionId}`, vaultParam)).then(r => r.json()),
    enabled: !!currentSessionId,
    refetchInterval: 3000,
    select: (s: any) => ({ contextTokens: s?.contextTokens }),
  });

  const updateConfig = useMutation({
    mutationFn: (data: any) =>
      apiRequest("PATCH", "/api/config", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/info"] });
    },
  });

  const resetStats = useMutation({
    mutationFn: () =>
      apiRequest("POST", withVault("/api/stats/reset", vaultParam)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const totalTokens = (stats?.totalInputTokens || 0) + (stats?.totalOutputTokens || 0);
  const provider = info?.provider || "none";
  const hasKey = info?.hasApiKey || false;

  // Find which providers have keys set
  const availableProviders = Object.entries(info?.keyStatus || {})
    .filter(([, v]) => v.set)
    .map(([k]) => k);

  const handleProviderSwitch = (newProvider: string) => {
    // Check if the provider has a key
    const keyStatus = info?.keyStatus?.[newProvider];
    if (!keyStatus?.set) {
      // Redirect to settings
      setLocation("/settings");
      return;
    }
    updateConfig.mutate({
      aiProvider: newProvider,
      aiModel: null, // clear model override so default kicks in (undefined is omitted in JSON)
    });
  };

  // Effective model: explicit override, or the provider's default
  const effectiveModel = config?.aiModel || PROVIDER_DEFAULT_MODELS[provider] || "";

  const { data: mcpStatus } = useQuery<Record<string, { connected: boolean; connecting: boolean; label: string; tools: string[] }>>({
    queryKey: ["/api/mcp/status"],
    queryFn: () => apiRequest("GET", "/api/mcp/status").then(r => r.json()),
    refetchInterval: 4000,
  });

  const mcpEntries = Object.entries(mcpStatus || {});
  const connectedCount = mcpEntries.filter(([, v]) => v.connected).length;
  const connectingCount = mcpEntries.filter(([, v]) => v.connecting).length;

  return (
    <div className="h-6 border-t border-border/50 bg-background/80 backdrop-blur-sm flex items-center px-3 text-[10px] text-muted-foreground gap-0 shrink-0 select-none">
      {/* Tokens section */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-1 px-1.5 h-full hover:bg-muted/50 rounded-sm transition-colors"
            onClick={() => resetStats.mutate()}
          >
            <Zap className="w-3 h-3" />
            <span className="tabular-nums">
              {formatTokens(totalTokens)} tokens
              {totalTokens > 0 && provider !== "none" && (
                <span className="ml-1 opacity-60">
                  {estimateCost(provider, stats?.totalInputTokens || 0, stats?.totalOutputTokens || 0)}
                </span>
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-0.5">
            <div>Input: {formatTokens(stats?.totalInputTokens || 0)}</div>
            <div>Output: {formatTokens(stats?.totalOutputTokens || 0)}</div>
            <div>Requests: {stats?.totalRequests || 0}</div>
            {totalTokens > 0 && provider !== "none" && (
              <div className="font-medium">Est. cost: {estimateCost(provider, stats?.totalInputTokens || 0, stats?.totalOutputTokens || 0)}</div>
            )}
            <div className="text-muted-foreground mt-1 flex items-center gap-1">
              <RotateCcw className="w-2.5 h-2.5" /> Click to reset
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Separator */}
      <div className="w-px h-3 bg-border/50 mx-1" />

      {/* Provider section */}
      {!hasKey ? (
        <button
          className="flex items-center gap-1 px-1.5 h-full hover:bg-muted/50 rounded-sm transition-colors text-yellow-500"
          onClick={() => setLocation("/settings")}
        >
          <AlertTriangle className="w-3 h-3" />
          <span>No API Key</span>
        </button>
      ) : (
        <div className="flex items-center gap-0.5">
          <Cpu className="w-3 h-3 mx-1" />
          <Select
            value={provider}
            onValueChange={handleProviderSwitch}
          >
            <SelectTrigger className="h-5 border-0 bg-transparent shadow-none text-[10px] text-muted-foreground px-1 py-0 min-w-0 w-auto gap-1 focus:ring-0 [&>svg]:w-2.5 [&>svg]:h-2.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" side="top" className="min-w-[120px]">
              {availableProviders.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {PROVIDER_NAMES[p] || p}
                </SelectItem>
              ))}
              {availableProviders.length === 0 && (
                <SelectItem value="none" className="text-xs" disabled>
                  No keys configured
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Model indicator — always show effective model */}
      {effectiveModel && provider !== "none" && (
        <>
          <div className="w-px h-3 bg-border/50 mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="px-1.5 font-mono truncate max-w-[140px]">
                {effectiveModel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {config?.aiModel
                ? `Model override: ${config.aiModel}`
                : `Default model for ${PROVIDER_NAMES[provider] || provider}`}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      {/* Context window fill — shown when in a chat session */}
      {currentSessionId && currentSession?.contextTokens != null && (() => {
        const used = currentSession.contextTokens;
        const limit = CONTEXT_WINDOW[provider] ?? 128_000;
        const pct = Math.min(100, Math.round((used / limit) * 100));
        const color = pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-primary/60";
        return (
          <>
            <div className="w-px h-3 bg-border/50 mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 px-1.5 h-full">
                  <Layers className="w-3 h-3" />
                  <div className="flex items-center gap-1">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="space-y-0.5">
                  <div className="font-medium">Context Window</div>
                  <div>Used: {formatTokens(used)} / {formatTokens(limit)}</div>
                  <div>{pct}% full</div>
                  {pct >= 80 && <div className="text-red-400 font-medium">⚠ Context nearly full</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          </>
        );
      })()}

      {/* Right-aligned spacer */}
      <div className="flex-1" />

      {/* MCP server status dots */}
      {mcpEntries.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5 px-1.5 h-full cursor-default">
              {mcpEntries.map(([name, srv]) => (
                <span
                  key={name}
                  className={`w-1.5 h-1.5 rounded-full ${
                    srv.connected
                      ? "bg-green-500"
                      : srv.connecting
                        ? "bg-yellow-400 animate-pulse"
                        : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            <div className="font-medium mb-1">MCP Servers</div>
            <div className="space-y-0.5">
              {mcpEntries.map(([name, srv]) => (
                <div key={name} className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    srv.connected ? "bg-green-500" : srv.connecting ? "bg-yellow-400" : "bg-muted-foreground/30"
                  }`} />
                  <span>{srv.label || name}</span>
                  <span className="opacity-50 ml-auto pl-2">
                    {srv.connected ? `${srv.tools.length} tools` : srv.connecting ? "connecting…" : "off"}
                  </span>
                </div>
              ))}
            </div>
            {connectedCount > 0 && <div className="mt-1 opacity-60">{connectedCount} of {mcpEntries.length} connected</div>}
            {connectingCount > 0 && <div className="text-yellow-400">{connectingCount} starting…</div>}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Separator before version */}
      {mcpEntries.length > 0 && <div className="w-px h-3 bg-border/50 mx-0.5" />}

      {/* Version */}
      <span className="px-1 opacity-50">v{info?.version || "1.0.0"}</span>
    </div>
  );
}
