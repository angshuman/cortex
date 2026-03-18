import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/ui/card";
import {
  Search,
  FileText,
  CheckSquare,
  MessageSquare,
} from "lucide-react";
import { useLocation } from "wouter";

interface SearchResult {
  id: string;
  type: "note" | "task" | "chat";
  title: string;
  snippet: string;
  score: number;
  path?: string;
}

const typeConfig = {
  note: { icon: FileText, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Note" },
  task: { icon: CheckSquare, color: "text-blue-500", bg: "bg-blue-500/10", label: "Task" },
  chat: { icon: MessageSquare, color: "text-purple-500", bg: "bg-purple-500/10", label: "Chat" },
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();
  const { vaultParam, vaultId } = useVault();

  const { data: results = [], isLoading } = useQuery<SearchResult[]>({
    queryKey: ["/api/search", query, vaultId],
    queryFn: () => query.length >= 2 ? apiRequest("GET", withVault(`/api/search?q=${encodeURIComponent(query)}`, vaultParam)).then(r => r.json()) : Promise.resolve([]),
    enabled: query.length >= 2 && !!vaultId,
  });

  const handleResultClick = (result: SearchResult) => {
    switch (result.type) {
      case "note": setLocation("/notes"); break;
      case "task": setLocation("/tasks"); break;
      case "chat": setLocation(`/chat/${result.id}`); break;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Search</span>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Search input */}
          <div className="relative mb-8">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search notes, tasks, and conversations..."
              className="h-11 pl-10 text-sm bg-muted/50 border-border/50 focus-visible:border-primary/50"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              data-testid="input-search"
            />
          </div>

          {/* Results */}
          {query.length < 2 && (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Searches across all notes, tasks, and chat history</p>
            </div>
          )}

          {query.length >= 2 && results.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No results for "{query}"</p>
            </div>
          )}

          <div className="space-y-2">
            {results.map(result => {
              const config = typeConfig[result.type];
              const Icon = config.icon;
              return (
                <Card
                  key={`${result.type}-${result.id}`}
                  className="p-3 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => handleResultClick(result)}
                  data-testid={`search-result-${result.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium">{result.title}</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">
                          {config.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{result.snippet}</p>
                      {result.path && (
                        <span className="text-[9px] text-muted-foreground/60">{result.path}</span>
                      )}
                    </div>
                    <span className="text-[9px] text-muted-foreground/40 shrink-0">
                      {Math.round(result.score * 100)}%
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
