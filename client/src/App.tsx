import { useState } from "react";
import { Switch, Route } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Router } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import ChatPage from "@/pages/chat";
import NotesPage from "@/pages/notes";
import TasksPage from "@/pages/tasks";
import SearchPage from "@/pages/search";
import SettingsPage from "@/pages/settings";
import FilesPage from "@/pages/files";
import NotFound from "@/pages/not-found";
import { ThemeProvider } from "@/components/theme-provider";
import { VaultProvider } from "@/hooks/use-vault";
import { ApiKeySetupDialog, useApiKeyCheck } from "@/components/api-key-dialog";
import { StatusBar } from "@/components/status-bar";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/chat/:id" component={ChatPage} />
      <Route path="/notes" component={NotesPage} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/files" component={FilesPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ApiKeyStartupCheck() {
  const { needsSetup } = useApiKeyCheck();
  const [dismissed, setDismissed] = useState(false);

  if (!needsSetup || dismissed) return null;

  return (
    <ApiKeySetupDialog
      open={true}
      onOpenChange={(open) => { if (!open) setDismissed(true); }}
      mode="dialog"
    />
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <VaultProvider>
          <TooltipProvider>
            <Router hook={useHashLocation}>
              <SidebarProvider style={style as React.CSSProperties}>
                <div className="flex h-screen w-full bg-background">
                  <AppSidebar />
                  <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      <AppRouter />
                    </div>
                    <StatusBar />
                  </main>
                </div>
              </SidebarProvider>
            </Router>
            <ApiKeyStartupCheck />
            <Toaster />
          </TooltipProvider>
        </VaultProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
