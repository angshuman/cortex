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
  SlidersHorizontal,
  MessageSquare,
  Timer,
  FileText,
  Thermometer,
  Plus,
  Trash2,
  Server,
  RefreshCw,
  AlertCircle,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ApiKeySetupDialog } from "@/components/api-key-dialog";
/** Open a folder in the native file manager (Explorer / Finder) */
async function openFolder(folderPath: string) {
  // Prefer Electron IPC if available
  const desktop = (window as any).cortexDesktop;
  if (desktop?.openFolder) {
    await desktop.openFolder(folderPath);
  } else {
    // Fallback to server-side endpoint
    await apiRequest("POST", "/api/open-folder", { folderPath });
  }
}

interface Skill {
  name: string;
  description: string;
  version: string;
  instructions: string;
  tools: any[];
  enabled: boolean;
  builtin: boolean;
  triggerKeywords: string[];
  category: string;
  instructionsOnly: boolean;
  priority: number;
  filePath: string | null;
}

const CATEGORY_ORDER = ["core", "browser", "research", "writing", "productivity", "custom"];
const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  browser: "Browser",
  research: "Research",
  writing: "Writing",
  productivity: "Productivity",
  custom: "Custom",
};
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  core: "Essential tools — always available",
  browser: "Web browsing and automation",
  research: "Search and deep research",
  writing: "Drafting and summarization",
  productivity: "Planning, code, and meetings",
  custom: "User-created skills",
};
const PRIORITY_LABELS = ["Always", "High", "Medium", "Low"];
const PRIORITY_COLORS = ["bg-green-500", "bg-blue-500", "bg-yellow-500", "bg-gray-400"];

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

  const saveSkill = useMutation({
    mutationFn: (skill: Skill) => apiRequest("POST", withVault("/api/skills", vaultParam), skill),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Skill saved" });
    },
  });

  const deleteSkillMutation = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", withVault(`/api/skills/${encodeURIComponent(name)}`, vaultParam)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Skill deleted" });
    },
  });

  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [creatingSkill, setCreatingSkill] = useState(false);

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
              {/* API Keys */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">AI Provider Keys</h3>
                  {info?.provider && info.provider !== "none" && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 ml-auto">
                      Active: {info.provider}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mb-3">
                  Add API keys to connect AI providers. The first configured key
                  determines the active provider.
                </p>
                <ApiKeySetupDialog open={false} onOpenChange={() => {}} mode="inline" />
                <div className="mt-3">
                  <Label className="text-xs text-muted-foreground">Model Override</Label>
                  <Input
                    className="mt-1 text-sm h-8"
                    placeholder="Auto-detect"
                    defaultValue={config?.aiModel || ""}
                    onBlur={(e) => updateConfig.mutate({ aiModel: e.target.value || undefined })}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Override the default model (e.g. gpt-4o, claude-sonnet-4-20250514, gemini-2.0-flash).
                  </p>
                </div>
              </Card>

              {/* Agent Settings */}
              <AgentSettingsCard config={config} updateConfig={updateConfig} />

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

              {/* MCP Servers */}
              <McpServersCard config={config} updateConfig={updateConfig} />

              {/* Storage */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">Storage</h3>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data Root Directory</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 truncate">
                      {info?.dataDir || "~/.cortex-data"}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 shrink-0"
                      onClick={() => info?.dataDir && openFolder(info.dataDir)}
                      disabled={!info?.dataDir}
                      title="Open in file manager"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Set CORTEX_DATA_DIR env variable to change. Individual vaults can override this with custom folder paths.
                  </p>
                </div>
              </Card>
            </TabsContent>

            {/* ====== SKILLS TAB ====== */}
            <TabsContent value="skills" className="space-y-4">
              {editingSkill || creatingSkill ? (
                <SkillEditor
                  skill={editingSkill}
                  onSave={(skill) => {
                    saveSkill.mutate(skill);
                    setEditingSkill(null);
                    setCreatingSkill(false);
                  }}
                  onCancel={() => { setEditingSkill(null); setCreatingSkill(false); }}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Skills teach the AI agent how to behave. Drop .json files into your vault's skills/ directory to add custom skills.
                        {activeVault && <span className="ml-1 font-medium">Vault: {activeVault.icon} {activeVault.name}</span>}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setCreatingSkill(true)}
                    >
                      <Plus className="w-3 h-3 mr-1.5" />
                      New Skill
                    </Button>
                  </div>

                  {CATEGORY_ORDER.map(cat => {
                    const catSkills = skills.filter(s => (s.category || "custom") === cat);
                    if (catSkills.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {CATEGORY_LABELS[cat] || cat}
                          </h3>
                          <span className="text-[10px] text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</span>
                        </div>
                        <div className="space-y-2">
                          {catSkills.map(skill => (
                            <Card key={skill.name} className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[skill.priority ?? 1]} shrink-0`} title={`Priority: ${PRIORITY_LABELS[skill.priority ?? 1]}`} />
                                    <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span className="text-sm font-medium">{skill.name}</span>
                                    {skill.builtin && (
                                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">Built-in</Badge>
                                    )}
                                    {skill.instructionsOnly && (
                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5">Guide</Badge>
                                    )}
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5">v{skill.version}</Badge>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{skill.description}</p>
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {skill.tools?.map((t: any) => (
                                      <Badge key={t.name} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-3.5">
                                        {t.name}
                                      </Badge>
                                    ))}
                                    {(skill.triggerKeywords || []).slice(0, 5).map((kw: string) => (
                                      <Badge key={kw} variant="outline" className="text-[9px] px-1.5 py-0 h-3.5 text-blue-400 border-blue-400/30">
                                        {kw}
                                      </Badge>
                                    ))}
                                    {(skill.triggerKeywords || []).length > 5 && (
                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-3.5 text-blue-400 border-blue-400/30">
                                        +{skill.triggerKeywords.length - 5} more
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0"
                                    onClick={() => setEditingSkill(skill)}
                                    title="Edit skill"
                                  >
                                    <SlidersHorizontal className="w-3 h-3" />
                                  </Button>
                                  {!skill.builtin && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        if (confirm(`Delete skill "${skill.name}"?`)) {
                                          deleteSkillMutation.mutate(skill.name);
                                        }
                                      }}
                                      title="Delete skill"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                  <Switch
                                    checked={skill.enabled}
                                    onCheckedChange={() => toggleSkill.mutate(skill)}
                                    data-testid={`switch-skill-${skill.name}`}
                                  />
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
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
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[10px] text-muted-foreground font-mono truncate">
              {pathInfo?.path || "loading..."}
            </p>
            {pathInfo?.path && (
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 shrink-0 text-muted-foreground hover:text-primary"
                onClick={() => openFolder(pathInfo.path)}
                title="Open vault folder"
              >
                <ExternalLink className="w-2.5 h-2.5" />
              </Button>
            )}
          </div>
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

/** Agent tuning settings card */
function AgentSettingsCard({
  config,
  updateConfig,
}: {
  config: any;
  updateConfig: any;
}) {
  const agent = config?.agent || {};
  const [maxTurns, setMaxTurns] = useState(String(agent.maxTurns ?? 10));
  const [maxTokens, setMaxTokens] = useState(String(agent.maxTokens ?? 4096));
  const [temperature, setTemperature] = useState(String(agent.temperature ?? 0.7));
  const [fetchTimeout, setFetchTimeout] = useState(String(agent.fetchTimeout ?? 15000));
  const [fetchMaxLength, setFetchMaxLength] = useState(String(agent.fetchMaxLength ?? 15000));
  const [systemPromptSuffix, setSystemPromptSuffix] = useState(agent.systemPromptSuffix ?? "");

  // Sync when config changes externally
  useEffect(() => {
    const a = config?.agent || {};
    setMaxTurns(String(a.maxTurns ?? 10));
    setMaxTokens(String(a.maxTokens ?? 4096));
    setTemperature(String(a.temperature ?? 0.7));
    setFetchTimeout(String(a.fetchTimeout ?? 15000));
    setFetchMaxLength(String(a.fetchMaxLength ?? 15000));
    setSystemPromptSuffix(a.systemPromptSuffix ?? "");
  }, [config]);

  const saveField = (field: string, raw: string, type: "int" | "float" = "int") => {
    const value = type === "float" ? parseFloat(raw) : parseInt(raw, 10);
    if (isNaN(value)) return;
    updateConfig.mutate({ agent: { ...config?.agent, [field]: value } });
  };

  const savePromptSuffix = () => {
    updateConfig.mutate({ agent: { ...config?.agent, systemPromptSuffix } });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">Agent</h3>
      </div>

      <div className="space-y-4">
        {/* Row 1: Max Turns + Max Tokens */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <MessageSquare className="w-3 h-3" />
              Max Turns
            </Label>
            <Input
              className="text-xs h-8 font-mono"
              type="number"
              min={1}
              max={50}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
              onBlur={() => saveField("maxTurns", maxTurns)}
              onKeyDown={(e) => { if (e.key === "Enter") saveField("maxTurns", maxTurns); }}
              data-testid="input-max-turns"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Tool-call loops per message (1–50)
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <FileText className="w-3 h-3" />
              Max Tokens
            </Label>
            <Input
              className="text-xs h-8 font-mono"
              type="number"
              min={256}
              max={32768}
              step={256}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              onBlur={() => saveField("maxTokens", maxTokens)}
              onKeyDown={(e) => { if (e.key === "Enter") saveField("maxTokens", maxTokens); }}
              data-testid="input-max-tokens"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Response length limit (256–32768)
            </p>
          </div>
        </div>

        {/* Row 2: Temperature */}
        <div>
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
            <Thermometer className="w-3 h-3" />
            Temperature: {temperature}
          </Label>
          <Input
            className="text-xs h-8 font-mono"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            onBlur={() => saveField("temperature", temperature, "float")}
            onKeyDown={(e) => { if (e.key === "Enter") saveField("temperature", temperature, "float"); }}
            data-testid="input-temperature"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            0 = deterministic, 1 = balanced, 2 = creative
          </p>
        </div>

        {/* Row 3: Fetch settings */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Timer className="w-3 h-3" />
              Fetch Timeout (ms)
            </Label>
            <Input
              className="text-xs h-8 font-mono"
              type="number"
              min={1000}
              max={120000}
              step={1000}
              value={fetchTimeout}
              onChange={(e) => setFetchTimeout(e.target.value)}
              onBlur={() => saveField("fetchTimeout", fetchTimeout)}
              onKeyDown={(e) => { if (e.key === "Enter") saveField("fetchTimeout", fetchTimeout); }}
              data-testid="input-fetch-timeout"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              web_fetch timeout
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <FileText className="w-3 h-3" />
              Fetch Max Length
            </Label>
            <Input
              className="text-xs h-8 font-mono"
              type="number"
              min={1000}
              max={200000}
              step={1000}
              value={fetchMaxLength}
              onChange={(e) => setFetchMaxLength(e.target.value)}
              onBlur={() => saveField("fetchMaxLength", fetchMaxLength)}
              onKeyDown={(e) => { if (e.key === "Enter") saveField("fetchMaxLength", fetchMaxLength); }}
              data-testid="input-fetch-max-length"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Max chars from web_fetch
            </p>
          </div>
        </div>

        {/* Row 4: System Prompt Suffix */}
        <div>
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
            <Brain className="w-3 h-3" />
            Custom System Prompt
          </Label>
          <textarea
            className="w-full text-xs font-mono bg-background border border-input rounded-md px-3 py-2 min-h-[60px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Additional instructions appended to the system prompt..."
            value={systemPromptSuffix}
            onChange={(e) => setSystemPromptSuffix(e.target.value)}
            onBlur={savePromptSuffix}
            data-testid="textarea-system-prompt"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Appended as "Custom Instructions" to every system prompt. Use for persona, style, or domain-specific rules.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Skill create/edit form */
function SkillEditor({
  skill,
  onSave,
  onCancel,
}: {
  skill: Skill | null; // null = create new
  onSave: (skill: Skill) => void;
  onCancel: () => void;
}) {
  const isNew = !skill;
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [category, setCategory] = useState(skill?.category || "custom");
  const [priority, setPriority] = useState(String(skill?.priority ?? 1));
  const [keywords, setKeywords] = useState(skill?.triggerKeywords?.join(", ") || "");
  const [instructions, setInstructions] = useState(skill?.instructions || "");
  const [instructionsOnly, setInstructionsOnly] = useState(skill?.instructionsOnly ?? false);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      version: skill?.version || "1.0",
      instructions: instructions.trim(),
      tools: skill?.tools || [],
      enabled: skill?.enabled ?? true,
      builtin: skill?.builtin ?? false,
      triggerKeywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      category,
      instructionsOnly,
      priority: parseInt(priority, 10),
      filePath: skill?.filePath || null,
    });
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{isNew ? "New Skill" : `Edit: ${skill.name}`}</h3>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* Name */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
        <Input
          className="text-sm h-8"
          placeholder="my-skill"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isNew && skill.builtin}
          data-testid="input-skill-name"
        />
      </div>

      {/* Description */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
        <Input
          className="text-sm h-8"
          placeholder="What this skill does"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="input-skill-description"
        />
      </div>

      {/* Category + Priority row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_LABELS.map((label, i) => (
                <SelectItem key={i} value={String(i)}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[i]}`} />
                    {label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Trigger Keywords */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Trigger Keywords</Label>
        <Input
          className="text-sm h-8"
          placeholder="browse, navigate, click, website (comma-separated)"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          data-testid="input-skill-keywords"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Comma-separated words that activate this skill when detected in user messages.
        </p>
      </div>

      {/* Instructions Only toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs">Instructions Only (no tools)</Label>
          <p className="text-[10px] text-muted-foreground">
            Injects guidance into the system prompt without registering tools.
          </p>
        </div>
        <Switch
          checked={instructionsOnly}
          onCheckedChange={setInstructionsOnly}
          data-testid="switch-instructions-only"
        />
      </div>

      {/* Instructions textarea */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Instructions</Label>
        <textarea
          className="w-full text-xs font-mono bg-background border border-input rounded-md px-3 py-2 min-h-[200px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Detailed instructions for the AI agent when this skill is active..."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          data-testid="textarea-skill-instructions"
        />
      </div>

      {/* Save / Cancel buttons */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          size="sm"
          className="h-8 text-xs px-4"
          onClick={handleSave}
          disabled={!name.trim()}
          data-testid="button-save-skill"
        >
          <Check className="w-3 h-3 mr-1.5" />
          {isNew ? "Create Skill" : "Save Changes"}
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs px-4" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/** MCP Servers card — manage all MCP server connections */
function McpServersCard({
  config,
  updateConfig,
}: {
  config: any;
  updateConfig: any;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connectingServer, setConnectingServer] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("");

  // Poll MCP server status
  const { data: mcpStatus = {}, refetch: refetchMcpStatus } = useQuery<Record<string, any>>({
    queryKey: ["/api/mcp/status"],
    queryFn: () => apiRequest("GET", "/api/mcp/status").then(r => r.json()),
    refetchInterval: 5000,
  });

  // Get available presets
  const { data: presets = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/mcp/presets"],
    queryFn: () => apiRequest("GET", "/api/mcp/presets").then(r => r.json()),
  });

  const configuredServers = Object.keys(config?.mcpServers || {});
  // Merge: configured servers + connected servers (may include playwright via legacy field)
  const allServerNames = Array.from(new Set([
    ...configuredServers,
    ...Object.keys(mcpStatus),
  ]));

  // Preset names not yet added
  const availablePresets = Object.entries(presets).filter(
    ([name]) => !allServerNames.includes(name)
  );

  const handleConnect = async (serverName: string) => {
    setConnectingServer(serverName);
    try {
      // For playwright, also ensure browserBackend is set
      if (serverName === "playwright" && config?.browserBackend !== "playwright-mcp") {
        updateConfig.mutate({ browserBackend: "playwright-mcp" });
      }
      const resp = await apiRequest("POST", `/api/mcp/connect/${serverName}`);
      const result = await resp.json();
      await refetchMcpStatus();
      if (result.connected) {
        toast({ title: "Connected", description: `${serverName} is now active` });
      } else {
        toast({ title: "Connection failed", description: `Could not connect to ${serverName}`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    } finally {
      setConnectingServer(null);
    }
  };

  const handleDisconnect = async (serverName: string) => {
    try {
      await apiRequest("POST", `/api/mcp/disconnect/${serverName}`);
      await refetchMcpStatus();
      // For playwright, also disable the legacy field
      if (serverName === "playwright") {
        updateConfig.mutate({ browserBackend: "none" });
      }
      toast({ title: "Disconnected", description: `${serverName} has been disconnected` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReconnect = async (serverName: string) => {
    setConnectingServer(serverName);
    try {
      await apiRequest("POST", `/api/mcp/disconnect/${serverName}`);
      const resp = await apiRequest("POST", `/api/mcp/connect/${serverName}`);
      const result = await resp.json();
      await refetchMcpStatus();
      if (result.connected) {
        toast({ title: "Reconnected", description: `${serverName} is active` });
      } else {
        toast({ title: "Reconnect failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Reconnect failed", description: err.message, variant: "destructive" });
    } finally {
      setConnectingServer(null);
    }
  };

  const handleAddPreset = async (presetName: string) => {
    try {
      await apiRequest("POST", "/api/mcp/servers", { name: presetName });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      await refetchMcpStatus();
      toast({ title: "Server added", description: `${presetName} has been configured` });
      setShowAddDialog(false);
      // Auto-connect
      handleConnect(presetName);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleAddCustom = async () => {
    if (!customName.trim() || !customCommand.trim()) {
      toast({ title: "Name and command are required", variant: "destructive" });
      return;
    }
    const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : [];
    try {
      await apiRequest("POST", "/api/mcp/servers", {
        name: customName.trim(),
        command: customCommand.trim(),
        args,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      await refetchMcpStatus();
      toast({ title: "Server added", description: `${customName} has been configured` });
      setCustomName("");
      setCustomCommand("");
      setCustomArgs("");
      setShowAddDialog(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleRemove = async (serverName: string) => {
    try {
      await apiRequest("DELETE", `/api/mcp/servers/${serverName}`);
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      await refetchMcpStatus();
      // For playwright, also clear legacy field
      if (serverName === "playwright") {
        updateConfig.mutate({ browserBackend: "none" });
      }
      toast({ title: "Server removed", description: `${serverName} has been removed` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const connectedCount = Object.values(mcpStatus).filter((s: any) => s.connected).length;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Server className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">MCP Servers</h3>
        {connectedCount > 0 && (
          <Badge
            variant="default"
            className="text-[9px] px-1.5 py-0 h-3.5 ml-auto bg-green-500/20 text-green-400 border-green-500/30"
          >
            {connectedCount} connected
          </Badge>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground mb-3">
        MCP servers extend the AI agent with new capabilities — browser automation, Microsoft 365 access, and more.
      </p>

      {/* Server list */}
      <div className="space-y-2">
        {allServerNames.length === 0 && (
          <p className="text-xs text-muted-foreground italic py-2">No MCP servers configured.</p>
        )}

        {allServerNames.map(name => {
          const status = mcpStatus[name];
          const isConnected = status?.connected === true;
          const tools: string[] = status?.tools || [];
          const label = status?.label || presets[name]?.label || name;
          const description = status?.description || presets[name]?.description || "";
          const setupNotes = status?.setupNotes || presets[name]?.setupNotes;
          const isConnecting = connectingServer === name;

          return (
            <div key={name} className="border border-border/50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{label}</span>
                    <Badge
                      variant={isConnected ? "default" : "secondary"}
                      className={`text-[9px] px-1.5 py-0 h-3.5 ${
                        isConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : ""
                      }`}
                    >
                      {isConnected ? "Connected" : "Disconnected"}
                    </Badge>
                  </div>
                  {description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {isConnecting ? (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled>
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </Button>
                  ) : isConnected ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleReconnect(name)}
                        title="Reconnect"
                        data-testid={`button-reconnect-${name}`}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDisconnect(name)}
                        title="Disconnect"
                        data-testid={`button-disconnect-${name}`}
                      >
                        <PlugZap className="w-3 h-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => handleConnect(name)}
                      title="Connect"
                      data-testid={`button-connect-${name}`}
                    >
                      <Plug className="w-3 h-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(name)}
                    title="Remove server"
                    data-testid={`button-remove-${name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Tools list */}
              {isConnected && tools.length > 0 && (
                <div className="mt-2">
                  <Label className="text-[10px] text-muted-foreground mb-1 block">
                    {tools.length} tools available
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {tools.slice(0, 10).map((tool: string) => (
                      <Badge key={tool} variant="secondary" className="text-[9px] font-mono px-1.5 py-0 h-3.5">
                        {tool}
                      </Badge>
                    ))}
                    {tools.length > 10 && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">
                        +{tools.length - 10} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Setup notes for disconnected servers */}
              {!isConnected && setupNotes && (
                <div className="mt-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-[10px] text-muted-foreground">{setupNotes}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add server */}
      {!showAddDialog ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs mt-3 w-full"
          onClick={() => setShowAddDialog(true)}
          data-testid="button-add-mcp-server"
        >
          <Plus className="w-3 h-3 mr-1.5" />
          Add MCP Server
        </Button>
      ) : (
        <div className="mt-3 border border-border/50 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Add MCP Server</Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-[10px] px-2"
              onClick={() => setShowAddDialog(false)}
            >
              Cancel
            </Button>
          </div>

          {/* Preset buttons */}
          {availablePresets.length > 0 && (
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Quick Add (Presets)</Label>
              <div className="space-y-1.5">
                {availablePresets.map(([name, preset]: [string, any]) => (
                  <button
                    key={name}
                    className="w-full text-left p-2 border border-border/50 rounded-md hover:bg-muted/50 transition-colors"
                    onClick={() => handleAddPreset(name)}
                    data-testid={`button-add-preset-${name}`}
                  >
                    <div className="text-xs font-medium">{preset.label}</div>
                    <div className="text-[10px] text-muted-foreground">{preset.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom server form */}
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              {availablePresets.length > 0 ? "Or add custom" : "Custom Server"}
            </Label>
            <div className="space-y-2">
              <Input
                className="text-xs h-7 font-mono"
                placeholder="Server name (e.g. my-mcp-server)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                data-testid="input-custom-mcp-name"
              />
              <Input
                className="text-xs h-7 font-mono"
                placeholder="Command (e.g. npx)"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                data-testid="input-custom-mcp-command"
              />
              <Input
                className="text-xs h-7 font-mono"
                placeholder="Args (space-separated, e.g. -y @my/package mcp)"
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                data-testid="input-custom-mcp-args"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleAddCustom}
                disabled={!customName.trim() || !customCommand.trim()}
                data-testid="button-add-custom-mcp"
              >
                <Terminal className="w-3 h-3 mr-1.5" />
                Add Custom Server
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
