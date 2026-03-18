import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault, type Vault, type VaultSettings } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Brain,
  HardDrive,
  Zap,
  FolderOpen,
  Shield,
  Wrench,
  Info,
  Monitor,
  Eye,
  EyeOff,
  Vault as VaultIcon,
  ChevronRight,
  Check,
  Globe,
  Plug,
  PlugZap,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Skill {
  name: string;
  description: string;
  version: string;
  tools: any[];
  enabled: boolean;
  builtin: boolean;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { vaults, activeVault, vaultParam, vaultId, refetchVaults } = useVault();

  const { data: config } = useQuery({
    queryKey: ["/api/config"],
    queryFn: () => apiRequest("GET", "/api/config").then(r => r.json()),
  });

  const { data: info } = useQuery({
    queryKey: ["/api/info"],
    queryFn: () => apiRequest("GET", "/api/info").then(r => r.json()),
  });

  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ["/api/skills", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/skills", vaultParam)).then(r => r.json()),
    enabled: !!vaultId,
  });

  const updateConfig = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/config", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Settings saved" });
    },
  });

  const toggleSkill = useMutation({
    mutationFn: (skill: Skill) => apiRequest("POST", withVault("/api/skills", vaultParam), { ...skill, enabled: !skill.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <Settings className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Settings</span>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <Tabs defaultValue="vaults">
            <TabsList className="mb-6">
              <TabsTrigger value="vaults" className="text-xs">Vaults</TabsTrigger>
              <TabsTrigger value="general" className="text-xs">General</TabsTrigger>
              <TabsTrigger value="skills" className="text-xs">Skills</TabsTrigger>
              <TabsTrigger value="about" className="text-xs">About</TabsTrigger>
            </TabsList>

            {/* ====== VAULTS TAB ====== */}
            <TabsContent value="vaults" className="space-y-4">
              <p className="text-xs text-muted-foreground mb-2">
                Each vault is an independent workspace with its own notes, tasks, chats, and settings. Vaults map to folders on disk — you can point them anywhere.
              </p>
              {vaults.map(vault => (
                <VaultSettingsCard
                  key={vault.id}
                  vault={vault}
                  isActive={vault.id === activeVault?.id}
                  onUpdated={() => {
                    refetchVaults();
                    queryClient.invalidateQueries({ queryKey: ["/api/vaults"] });
                  }}
                />
              ))}
            </TabsContent>

            {/* ====== GENERAL TAB ====== */}
            <TabsContent value="general" className="space-y-6">
              {/* AI Provider */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">AI Provider</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Provider (auto-detected from env)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {info?.provider || "none"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY
                      </span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Model Override</Label>
                    <Input
                      className="mt-1 text-sm h-8"
                      placeholder="Auto-detect"
                      defaultValue={config?.aiModel || ""}
                      onBlur={(e) => updateConfig.mutate({ aiModel: e.target.value || undefined })}
                    />
                  </div>
                </div>
              </Card>

              {/* Vector Search */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">Search</h3>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Vector Search Backend</Label>
                  <Select
                    value={config?.vectorSearch || "local"}
                    onValueChange={(v) => updateConfig.mutate({ vectorSearch: v })}
                  >
                    <SelectTrigger className="mt-1 text-sm h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Local (keyword-based)</SelectItem>
                      <SelectItem value="openai">OpenAI Embeddings</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              {/* Browser */}
              <BrowserBackendCard config={config} updateConfig={updateConfig} />

              {/* Storage */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">Storage</h3>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data Root Directory</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                      {info?.dataDir || "~/.cortex-data"}
                    </code>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Set CORTEX_DATA_DIR env variable to change. Individual vaults can override this with custom folder paths.
                  </p>
                </div>
              </Card>
            </TabsContent>

            {/* ====== SKILLS TAB ====== */}
            <TabsContent value="skills" className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">
                Skills extend what the AI agent can do. Built-in skills are always available. You can add custom skills later.
                {activeVault && <span className="ml-1 font-medium">Showing skills for {activeVault.icon} {activeVault.name}.</span>}
              </p>
              {skills.map(skill => (
                <Card key={skill.name} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{skill.name}</span>
                        {skill.builtin && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">Built-in</Badge>
                        )}
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5">v{skill.version}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{skill.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {skill.tools.map(t => (
                          <Badge key={t.name} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-3.5">
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={() => toggleSkill.mutate(skill)}
                      data-testid={`switch-skill-${skill.name}`}
                    />
                  </div>
                </Card>
              ))}
            </TabsContent>

            {/* ====== ABOUT TAB ====== */}
            <TabsContent value="about" className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Cortex</h3>
                    <p className="text-[11px] text-muted-foreground">Personal AI Operating System</p>
                  </div>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>Version: {info?.version || "1.0.0"}</p>
                  <p>Data: All stored as plain JSON and Markdown files on your filesystem.</p>
                  <p>Sync: Copy vault folders to OneDrive, Google Drive, or USB for portability.</p>
                  <p>Privacy: Everything runs locally. AI calls go directly to your configured provider.</p>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}

/** Individual vault settings card */
function VaultSettingsCard({
  vault,
  isActive,
  onUpdated,
}: {
  vault: Vault;
  isActive: boolean;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [folderPath, setFolderPath] = useState(vault.settings?.folderPath || "");
  const [browserHeadless, setBrowserHeadless] = useState(vault.settings?.browserHeadless ?? false);
  const [aiModel, setAiModel] = useState(vault.settings?.aiModel || "");
  const [saving, setSaving] = useState(false);

  // Fetch resolved path (actual disk location)
  const { data: pathInfo } = useQuery({
    queryKey: ["/api/vaults", vault.id, "path"],
    queryFn: () => apiRequest("GET", `/api/vaults/${vault.id}/path`).then(r => r.json()),
  });

  // Sync local state when vault prop changes
  useEffect(() => {
    setFolderPath(vault.settings?.folderPath || "");
    setBrowserHeadless(vault.settings?.browserHeadless ?? false);
    setAiModel(vault.settings?.aiModel || "");
  }, [vault]);

  const saveSettings = async (updates: Partial<VaultSettings>) => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/vaults/${vault.id}/settings`, updates);
      onUpdated();
      toast({ title: "Vault settings saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHeadless = async (checked: boolean) => {
    setBrowserHeadless(checked);
    await saveSettings({ browserHeadless: checked });
  };

  const handleSaveFolderPath = async () => {
    const value = folderPath.trim() || null;
    await saveSettings({ folderPath: value });
  };

  const handleSaveAiModel = async () => {
    const value = aiModel.trim() || null;
    await saveSettings({ aiModel: value });
  };

  return (
    <Card className={`p-4 ${isActive ? "ring-1 ring-primary/30" : ""}`}>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-lg">{vault.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{vault.name}</span>
            {isActive && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">Active</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
            {pathInfo?.path || "loading..."}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Folder Path */}
        <div>
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <FolderOpen className="w-3 h-3" />
            Data Folder
          </Label>
          <div className="flex gap-2">
            <Input
              className="text-xs h-8 font-mono flex-1"
              placeholder="Default (inside .cortex-data)"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveFolderPath(); }}
              data-testid={`input-vault-folder-${vault.slug}`}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs px-3"
              onClick={handleSaveFolderPath}
              disabled={saving}
              data-testid={`button-save-folder-${vault.slug}`}
            >
              {saving ? "..." : "Save"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Absolute path to an external folder (e.g. D:\CortexVaults\work or ~/Google Drive/cortex-work). Leave empty for default location.
          </p>
        </div>

        {/* Browser Headless */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs flex items-center gap-1.5">
              <Monitor className="w-3 h-3 text-muted-foreground" />
              Browser Headless Mode
            </Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {browserHeadless
                ? "Browser runs invisibly in the background"
                : "Browser window will be visible when browsing"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {browserHeadless ? (
              <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-primary" />
            )}
            <Switch
              checked={browserHeadless}
              onCheckedChange={handleToggleHeadless}
              data-testid={`switch-headless-${vault.slug}`}
            />
          </div>
        </div>

        {/* AI Model Override */}
        <div>
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3 h-3" />
            AI Model Override
          </Label>
          <div className="flex gap-2">
            <Input
              className="text-xs h-8 font-mono flex-1"
              placeholder="Use global default"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveAiModel(); }}
              data-testid={`input-vault-model-${vault.slug}`}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs px-3"
              onClick={handleSaveAiModel}
              disabled={saving}
              data-testid={`button-save-model-${vault.slug}`}
            >
              {saving ? "..." : "Save"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Override the AI model for this vault only (e.g. claude-sonnet-4-20250514, gpt-4o).
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Browser Backend settings card with MCP status */
function BrowserBackendCard({
  config,
  updateConfig,
}: {
  config: any;
  updateConfig: any;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { data: mcpStatus, refetch: refetchMcpStatus } = useQuery({
    queryKey: ["/api/mcp/status"],
    queryFn: () => apiRequest("GET", "/api/mcp/status").then(r => r.json()),
    refetchInterval: 5000,
  });

  const isPlaywrightConnected = mcpStatus?.playwright?.connected === true;
  const playwrightTools = mcpStatus?.playwright?.tools || [];
  const isEnabled = config?.browserBackend === "playwright-mcp";

  const handleToggle = async (value: string) => {
    updateConfig.mutate({ browserBackend: value });
    if (value === "playwright-mcp") {
      // Auto-connect after enabling
      setConnecting(true);
      try {
        await apiRequest("POST", "/api/mcp/connect");
        await refetchMcpStatus();
        toast({ title: "Browser connected", description: "Playwright MCP is now active" });
      } catch (err: any) {
        toast({ title: "Connection failed", description: err.message, variant: "destructive" });
      } finally {
        setConnecting(false);
      }
    } else {
      // Disconnect
      try {
        await apiRequest("POST", "/api/mcp/disconnect");
        await refetchMcpStatus();
      } catch (e) {}
    }
  };

  const handleReconnect = async () => {
    setConnecting(true);
    try {
      // Disconnect first, then reconnect
      await apiRequest("POST", "/api/mcp/disconnect");
      const resp = await apiRequest("POST", "/api/mcp/connect");
      const result = await resp.json();
      await refetchMcpStatus();
      if (result.connected) {
        toast({ title: "Reconnected", description: "Playwright MCP is active" });
      } else {
        toast({ title: "Connection failed", description: "Check that @playwright/mcp is installed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">Browser Backend</h3>
        {isEnabled && (
          <Badge
            variant={isPlaywrightConnected ? "default" : "secondary"}
            className={`text-[9px] px-1.5 py-0 h-3.5 ml-auto ${
              isPlaywrightConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : ""
            }`}
          >
            {isPlaywrightConnected ? "Connected" : "Disconnected"}
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">Backend</Label>
          <Select
            value={config?.browserBackend || "none"}
            onValueChange={handleToggle}
          >
            <SelectTrigger className="mt-1 text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (disabled)</SelectItem>
              <SelectItem value="playwright-mcp">Playwright MCP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isEnabled && (
          <>
            <div className="flex items-center gap-2">
              {connecting ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Connecting...
                </Button>
              ) : isPlaywrightConnected ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReconnect}>
                  <PlugZap className="w-3 h-3 mr-1.5" />
                  Reconnect
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReconnect}>
                  <Plug className="w-3 h-3 mr-1.5" />
                  Connect
                </Button>
              )}
            </div>

            {isPlaywrightConnected && playwrightTools.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">
                  {playwrightTools.length} browser tools available
                </Label>
                <div className="flex flex-wrap gap-1">
                  {playwrightTools.slice(0, 12).map((tool: string) => (
                    <Badge key={tool} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-3.5">
                      {tool}
                    </Badge>
                  ))}
                  {playwrightTools.length > 12 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">
                      +{playwrightTools.length - 12} more
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {!isPlaywrightConnected && !connecting && (
              <p className="text-[10px] text-muted-foreground">
                Make sure <code className="text-[10px] bg-muted px-1 rounded">@playwright/mcp</code> is installed:
                <code className="text-[10px] bg-muted px-1 rounded ml-1">npm install -g @playwright/mcp</code>
              </p>
            )}
          </>
        )}

        {!isEnabled && (
          <p className="text-[10px] text-muted-foreground">
            Enable Playwright MCP to let the AI agent browse websites, fill forms, and interact with web pages.
          </p>
        )}
      </div>
    </Card>
  );
}
