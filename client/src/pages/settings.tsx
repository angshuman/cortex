import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
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
  const { vaultParam, vaultId } = useVault();

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
          <Tabs defaultValue="general">
            <TabsList className="mb-6">
              <TabsTrigger value="general" className="text-xs">General</TabsTrigger>
              <TabsTrigger value="skills" className="text-xs">Skills</TabsTrigger>
              <TabsTrigger value="about" className="text-xs">About</TabsTrigger>
            </TabsList>

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
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">Browser</h3>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Browser Backend</Label>
                  <Select
                    value={config?.browserBackend || "none"}
                    onValueChange={(v) => updateConfig.mutate({ browserBackend: v })}
                  >
                    <SelectTrigger className="mt-1 text-sm h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="playwright-mcp">Playwright MCP</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Start Playwright MCP server externally: npx @playwright/mcp@latest
                  </p>
                </div>
              </Card>

              {/* Storage */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium">Storage</h3>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data Directory</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                      {info?.dataDir || "~/.cortex-data"}
                    </code>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Set CORTEX_DATA_DIR env variable to change. Sync this folder with OneDrive, Google Drive, or USB.
                  </p>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="skills" className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">
                Skills extend what the AI agent can do. Built-in skills are always available. You can add custom skills later.
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
                  <p>Sync: Copy the data directory to OneDrive, Google Drive, or USB for portability.</p>
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
