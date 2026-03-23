import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { useLocation } from "wouter";
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
import { Zap, Cpu, AlertTriangle, RotateCcw } from "lucide-react";

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  grok: "Grok",
  google: "Gemini",
  none: "No Provider",
};

const PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-3",
  google: "gemini-2.0-flash",
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

export function StatusBar() {
  const queryClient = useQueryClient();
  const { vaultParam } = useVault();
  const [, setLocation] = useLocation();

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
  }>({
    queryKey: ["/api/info"],
    queryFn: () => apiRequest("GET", "/api/info").then((r) => r.json()),
  });

  const { data: config } = useQuery<any>({
    queryKey: ["/api/config"],
    queryFn: () => apiRequest("GET", "/api/config").then((r) => r.json()),
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
      aiModel: PROVIDER_MODELS[newProvider] || undefined,
    });
  };

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

      {/* Model indicator */}
      {config?.aiModel && (
        <>
          <div className="w-px h-3 bg-border/50 mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="px-1.5 font-mono truncate max-w-[120px]">
                {config.aiModel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Model override: {config.aiModel}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      {/* Right-aligned spacer */}
      <div className="flex-1" />

      {/* Version */}
      <span className="px-1 opacity-50">v2.0</span>
    </div>
  );
}
