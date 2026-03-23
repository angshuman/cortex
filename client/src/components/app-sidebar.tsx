import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault, type Vault } from "@/hooks/use-vault";
import cortexIcon from "@/assets/cortex-icon.png";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  FileText,
  CheckSquare,
  FolderOpen,
  Search,
  Settings,
  Plus,
  Sun,
  Moon,
  Brain,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Vault as VaultIcon,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const navItems = [
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Notes", href: "/notes", icon: FileText },
  { title: "Tasks", href: "/tasks", icon: CheckSquare },
  { title: "Files", href: "/files", icon: FolderOpen },
  { title: "Search", href: "/search", icon: Search },
  { title: "Settings", href: "/settings", icon: Settings },
];



// ============ Chat Session Grouping ============
function getTimeGroup(dateStr: string): { key: string; label: string; order: number } {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return { key: "just-now", label: "Just now", order: 0 };
  if (diffHours < 24 && d.getDate() === now.getDate()) return { key: "today", label: "Today", order: 1 };
  if (diffDays < 2) return { key: "yesterday", label: "Yesterday", order: 2 };
  if (diffDays < 7) return { key: "this-week", label: "This week", order: 3 };
  if (diffDays < 30) return { key: "this-month", label: "This month", order: 4 };
  return { key: "older", label: "Older", order: 5 };
}

function ChatSessionGroups({ sessions, location }: { sessions: any[]; location: string }) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["older"]));

  const grouped = useMemo(() => {
    const groups: Record<string, { label: string; order: number; sessions: any[] }> = {};
    for (const s of sessions.slice(0, 50)) {
      const g = getTimeGroup(s.createdAt);
      if (!groups[g.key]) groups[g.key] = { label: g.label, order: g.order, sessions: [] };
      groups[g.key].sessions.push(s);
    }
    return Object.entries(groups)
      .sort(([, a], [, b]) => a.order - b.order);
  }, [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ScrollArea className="max-h-[400px]">
      {grouped.map(([key, group]) => {
        const isCollapsed = collapsedGroups.has(key);
        return (
          <SidebarGroup key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="flex items-center gap-1 px-3 py-1.5 w-full text-left group hover:bg-muted/30 rounded transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/40 transition-transform" />
                : <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/40 transition-transform" />
              }
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">{group.label}</span>
              <span className="text-[9px] text-muted-foreground/25 ml-auto tabular-nums">{group.sessions.length}</span>
            </button>
            {!isCollapsed && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.sessions.map((s: any) => (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={location === `/chat/${s.id}`}
                        className="text-xs"
                      >
                        <Link href={`/chat/${s.id}`}>
                          <MessageSquare className="w-3 h-3 shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        );
      })}
    </ScrollArea>
  );
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { resolved, setTheme } = useTheme();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const queryClient = useQueryClient();
  const { vaults, activeVault, setActiveVaultId, vaultParam, refetchVaults } = useVault();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dialogName, setDialogName] = useState("");
  const [editingVault, setEditingVault] = useState<Vault | null>(null);

  const { data: sessions } = useQuery({
    queryKey: ["/api/chat/sessions", activeVault?.id],
    queryFn: () => apiRequest("GET", withVault("/api/chat/sessions", vaultParam)).then(r => r.json()),
    refetchInterval: 5000,
    enabled: !!activeVault,
  });

  const handleNewChat = async () => {
    try {
      const res = await apiRequest("POST", withVault("/api/chat/sessions", vaultParam), { title: "New Chat" });
      const session = await res.json();
      setLocation(`/chat/${session.id}`);
    } catch {}
  };

  const handleCreateVault = async () => {
    if (!dialogName.trim()) return;
    try {
      const res = await apiRequest("POST", "/api/vaults", {
        name: dialogName.trim(),
        icon: dialogName.trim().charAt(0).toUpperCase(),
        color: "#64748b",
      });
      const vault = await res.json();
      refetchVaults();
      setActiveVaultId(vault.id);
      setShowCreateDialog(false);
      setDialogName("");
      setLocation("/chat");
    } catch {}
  };

  const handleRenameVault = async () => {
    if (!editingVault || !dialogName.trim()) return;
    try {
      await apiRequest("PATCH", `/api/vaults/${editingVault.id}`, {
        name: dialogName.trim(),
        icon: dialogName.trim().charAt(0).toUpperCase(),
        color: "#64748b",
      });
      refetchVaults();
      setShowRenameDialog(false);
      setEditingVault(null);
    } catch {}
  };

  const handleDeleteVault = async () => {
    if (!editingVault) return;
    try {
      await apiRequest("DELETE", `/api/vaults/${editingVault.id}`);
      refetchVaults();
      setShowDeleteConfirm(false);
      setEditingVault(null);
    } catch {}
  };

  const openRename = (v: Vault) => {
    setEditingVault(v);
    setDialogName(v.name);
    setShowRenameDialog(true);
  };

  const openDelete = (v: Vault) => {
    setEditingVault(v);
    setShowDeleteConfirm(true);
  };

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-border/50">
        <SidebarHeader className="p-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg overflow-hidden">
              <img src={cortexIcon} alt="Cortex" className="w-7 h-7" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight">Cortex</span>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Vault Switcher */}
          {!collapsed && activeVault && (
            <div className="px-3 mb-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors text-left"
                    data-testid="button-vault-switcher"
                  >
                    <span className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-[10px] font-semibold text-muted-foreground uppercase leading-none">{activeVault.name?.charAt(0) || "V"}</span>
                    <span className="text-xs font-medium flex-1 truncate">{activeVault.name}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {vaults.map(v => (
                    <DropdownMenuItem
                      key={v.id}
                      className="flex items-center gap-2 justify-between group"
                      onClick={() => { setActiveVaultId(v.id); setLocation("/chat"); }}
                      data-testid={`vault-item-${v.slug}`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-[10px] font-semibold text-muted-foreground uppercase leading-none shrink-0">{v.name?.charAt(0) || "V"}</span>
                        <span className="text-xs truncate">{v.name}</span>
                        {v.id === activeVault.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openRename(v); }}
                          className="p-0.5 rounded hover:bg-muted"
                          data-testid={`button-rename-vault-${v.slug}`}
                        >
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </button>
                        {vaults.length > 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openDelete(v); }}
                            className="p-0.5 rounded hover:bg-destructive/10"
                            data-testid={`button-delete-vault-${v.slug}`}
                          >
                            <Trash2 className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setDialogName("");
                      setShowCreateDialog(true);
                    }}
                    className="flex items-center gap-2"
                    data-testid="button-create-vault"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-xs">New Vault</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Collapsed vault indicator */}
          {collapsed && activeVault && (
            <div className="flex justify-center mb-2">
              <button
                className="w-8 h-8 rounded-lg border border-border/50 flex items-center justify-center hover:bg-muted/50 transition-colors text-base"
                title={activeVault.name}
                data-testid="button-vault-switcher-collapsed"
              >
                <span className="text-xs font-semibold text-muted-foreground uppercase">{activeVault.name?.charAt(0) || "V"}</span>
              </button>
            </div>
          )}

          {/* New Chat button */}
          <div className="px-3 mb-1">
            <Button
              variant="outline"
              size={collapsed ? "icon" : "sm"}
              className="w-full justify-start gap-2 text-xs"
              onClick={handleNewChat}
              data-testid="button-new-chat"
            >
              <Plus className="w-3.5 h-3.5" />
              {!collapsed && "New Chat"}
            </Button>
          </div>

          {/* Main nav */}
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-3">Navigate</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = location === item.href || location.startsWith(item.href + "/") || (item.href === "/chat" && location === "/");
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <Link href={item.href} data-testid={`nav-${item.title.toLowerCase()}`}>
                          <item.icon className="w-4 h-4" />
                          <span className="text-sm">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Recent chats — grouped by time */}
          {!collapsed && sessions && sessions.length > 0 && (
            <ChatSessionGroups sessions={sessions as any[]} location={location} />
          )}
        </SidebarContent>

        <SidebarFooter className="p-3 pt-0">
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8"
            onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            data-testid="button-theme-toggle"
          >
            {resolved === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
        </SidebarFooter>
      </Sidebar>

      {/* Create Vault Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Create Vault</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Name</label>
              <Input
                value={dialogName}
                onChange={e => setDialogName(e.target.value)}
                placeholder="e.g. Work, Personal, Research..."
                className="text-sm"
                data-testid="input-vault-name"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleCreateVault(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateVault} disabled={!dialogName.trim()} data-testid="button-confirm-create-vault">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Vault Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Rename Vault</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Name</label>
              <Input
                value={dialogName}
                onChange={e => setDialogName(e.target.value)}
                className="text-sm"
                data-testid="input-rename-vault"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleRenameVault(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowRenameDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleRenameVault} disabled={!dialogName.trim()} data-testid="button-confirm-rename-vault">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Vault Confirm */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-base">Delete Vault</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to remove <span className="font-medium text-foreground">{editingVault?.name}</span>? The data folder will be kept on disk for safety.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteVault} data-testid="button-confirm-delete-vault">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
