import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  FileText,
  CheckSquare,
  Search,
  Settings,
  Plus,
  Sun,
  Moon,
  Brain,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const navItems = [
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Notes", href: "/notes", icon: FileText },
  { title: "Tasks", href: "/tasks", icon: CheckSquare },
  { title: "Search", href: "/search", icon: Search },
  { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { resolved, setTheme } = useTheme();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const { data: sessions } = useQuery({
    queryKey: ["/api/chat/sessions"],
    queryFn: () => apiRequest("GET", "/api/chat/sessions").then(r => r.json()),
    refetchInterval: 5000,
  });

  const handleNewChat = async () => {
    try {
      const res = await apiRequest("POST", "/api/chat/sessions", { title: "New Chat" });
      const session = await res.json();
      setLocation(`/chat/${session.id}`);
    } catch {}
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight">Cortex</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
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

        {/* Recent chats */}
        {!collapsed && sessions && sessions.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-3">Recent Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <ScrollArea className="max-h-[300px]">
                <SidebarMenu>
                  {(sessions as any[]).slice(0, 20).map((s: any) => (
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
              </ScrollArea>
            </SidebarGroupContent>
          </SidebarGroup>
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
  );
}
