import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Key,
  Check,
  X,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProviderInfo {
  id: string;
  name: string;
  keyPrefix: string;
  placeholder: string;
  docsUrl: string;
  color: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    name: "OpenAI",
    keyPrefix: "sk-",
    placeholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    color: "text-green-400",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    keyPrefix: "sk-ant-",
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    color: "text-orange-400",
  },
  {
    id: "grok",
    name: "xAI (Grok)",
    keyPrefix: "xai-",
    placeholder: "xai-...",
    docsUrl: "https://console.x.ai/",
    color: "text-blue-400",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    keyPrefix: "AI",
    placeholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
    color: "text-yellow-400",
  },
];

/**
 * Startup dialog shown when no API keys are configured.
 * Also reusable as a key management panel in Settings.
 */
export function ApiKeySetupDialog({
  open,
  onOpenChange,
  mode = "dialog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "dialog" | "inline";
}) {
  const content = <ApiKeyForm onDone={() => onOpenChange(false)} mode={mode} />;

  if (mode === "inline") {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            Welcome to Cortex
          </DialogTitle>
          <DialogDescription>
            To get started, add at least one AI provider API key. Your key is
            stored locally in your data directory — never sent anywhere except
            the provider's API.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyForm({
  onDone,
  mode,
}: {
  onDone: () => void;
  mode: "dialog" | "inline";
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: keyStatus } = useQuery<
    Record<
      string,
      { set: boolean; source: string; masked: string }
    >
  >({
    queryKey: ["/api/keys"],
    queryFn: () => apiRequest("GET", "/api/keys").then((r) => r.json()),
  });

  // Track which provider is expanded for editing
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<
    Record<string, { valid: boolean; error?: string; warning?: string }>
  >({});

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiRequest("PATCH", "/api/keys", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/info"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
    },
  });

  const verifyKey = async (provider: string, key: string) => {
    setVerifying(provider);
    setVerifyResults((prev) => ({ ...prev, [provider]: undefined as any }));
    try {
      const resp = await apiRequest("POST", "/api/keys/verify", {
        provider,
        key,
      });
      const result = await resp.json();
      setVerifyResults((prev) => ({ ...prev, [provider]: result }));
      if (result.valid) {
        // Auto-save on successful verification
        await saveMutation.mutateAsync({ [provider]: key });
        setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
        setExpandedProvider(null);
        toast({
          title: "Key verified and saved",
          description: result.warning || `${PROVIDERS.find((p) => p.id === provider)?.name} is ready to use.`,
        });
      } else {
        toast({
          title: "Invalid key",
          description: result.error || "The key could not be verified.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      setVerifyResults((prev) => ({
        ...prev,
        [provider]: { valid: false, error: err.message },
      }));
      toast({
        title: "Verification failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setVerifying(null);
    }
  };

  const removeKey = async (provider: string) => {
    await saveMutation.mutateAsync({ [provider]: "" });
    setVerifyResults((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    toast({ title: "Key removed", description: `${PROVIDERS.find((p) => p.id === provider)?.name} key has been removed.` });
  };

  const hasAnyKey = keyStatus
    ? Object.values(keyStatus).some((k) => k.set)
    : false;

  return (
    <div className="space-y-3">
      {PROVIDERS.map((provider) => {
        const status = keyStatus?.[provider.id];
        const isSet = status?.set;
        const isExpanded = expandedProvider === provider.id;
        const inputValue = keyInputs[provider.id] || "";
        const isVerifying = verifying === provider.id;
        const verifyResult = verifyResults[provider.id];

        return (
          <div
            key={provider.id}
            className="border border-border/50 rounded-lg overflow-hidden"
          >
            {/* Header row */}
            <button
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
              onClick={() =>
                setExpandedProvider(isExpanded ? null : provider.id)
              }
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${provider.color}`}>
                    {provider.name}
                  </span>
                  {isSet && (
                    <Badge
                      variant="default"
                      className="text-[9px] px-1.5 py-0 h-3.5 bg-green-500/20 text-green-400 border-green-500/30"
                    >
                      <Check className="w-2.5 h-2.5 mr-0.5" />
                      {status?.source === "env" ? "From env" : "Configured"}
                    </Badge>
                  )}
                </div>
                {isSet && status?.masked && (
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {status.masked}
                  </p>
                )}
              </div>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </button>

            {/* Expanded form */}
            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      className="text-xs h-8 font-mono pr-8"
                      type={showKeys[provider.id] ? "text" : "password"}
                      placeholder={provider.placeholder}
                      value={inputValue}
                      onChange={(e) =>
                        setKeyInputs((prev) => ({
                          ...prev,
                          [provider.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inputValue.trim()) {
                          verifyKey(provider.id, inputValue.trim());
                        }
                      }}
                      autoFocus
                    />
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setShowKeys((prev) => ({
                          ...prev,
                          [provider.id]: !prev[provider.id],
                        }))
                      }
                      type="button"
                    >
                      {showKeys[provider.id] ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 text-xs px-3"
                    onClick={() => verifyKey(provider.id, inputValue.trim())}
                    disabled={!inputValue.trim() || isVerifying}
                  >
                    {isVerifying ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Check className="w-3 h-3 mr-1" />
                    )}
                    Verify & Save
                  </Button>
                </div>

                {/* Verify result feedback */}
                {verifyResult && !verifyResult.valid && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-400">
                    <X className="w-3 h-3 shrink-0" />
                    {verifyResult.error || "Key is invalid"}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                  >
                    Get an API key
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  {isSet && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => removeKey(provider.id)}
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Security note */}
      <div className="flex items-start gap-2 pt-1">
        <Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground">
          Keys are stored in your local config.json file. They are only sent to
          the respective provider's API. Environment variables are also
          supported and take lower priority.
        </p>
      </div>

      {/* Done button (dialog mode only) */}
      {mode === "dialog" && (
        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={onDone}
            disabled={!hasAnyKey}
            className="text-xs"
          >
            {hasAnyKey ? "Get Started" : "Add at least one key to continue"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Hook to check if the API key setup dialog should show on startup.
 */
export function useApiKeyCheck() {
  const { data: info, isLoading } = useQuery<{
    hasApiKey: boolean;
    provider: string;
    keyStatus: Record<string, any>;
  }>({
    queryKey: ["/api/info"],
    queryFn: () => apiRequest("GET", "/api/info").then((r) => r.json()),
  });

  return {
    needsSetup: !isLoading && info && !info.hasApiKey,
    isLoading,
  };
}
