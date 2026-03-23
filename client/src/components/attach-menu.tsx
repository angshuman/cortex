import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus,
  Upload,
  FileText,
  CheckSquare,
  ChevronRight,
  Search,
} from "lucide-react";

interface AttachMenuItem {
  type: "note" | "task";
  id: string;
  title: string;
}

interface AttachMenuProps {
  /** Called when user picks a file to upload */
  onUploadFile: () => void;
  /** Called when user selects a note/task to add as context */
  onAttachItem?: (item: AttachMenuItem) => void;
  /** Size variant */
  size?: "sm" | "md";
}

export function AttachMenu({ onUploadFile, onAttachItem, size = "md" }: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"notes" | "tasks" | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const { vaultParam, vaultId } = useVault();

  const { data: notes = [] } = useQuery<any[]>({
    queryKey: ["/api/notes", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/notes", vaultParam)).then(r => r.json()),
    enabled: !!vaultId && open,
  });

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/tasks", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/tasks", vaultParam)).then(r => r.json()),
    enabled: !!vaultId && open,
  });

  const filteredItems = useMemo(() => {
    const items = submenu === "notes" ? notes : submenu === "tasks" ? tasks : [];
    if (!filter) return items.slice(0, 20);
    const q = filter.toLowerCase();
    return items.filter((i: any) => i.title?.toLowerCase().includes(q)).slice(0, 20);
  }, [submenu, notes, tasks, filter]);

  const handleSelect = (item: any) => {
    onAttachItem?.({
      type: submenu === "notes" ? "note" : "task",
      id: item.id,
      title: item.title,
    });
    setOpen(false);
    setSubmenu(null);
    setFilter("");
  };

  const handleUpload = () => {
    onUploadFile();
    setOpen(false);
    setSubmenu(null);
    setFilter("");
  };

  const handleBack = () => {
    setSubmenu(null);
    setFilter("");
  };

  const btnSize = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSubmenu(null); setFilter(""); } }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`${btnSize} rounded-lg text-muted-foreground/50 hover:text-foreground`}
          title="Attach"
        >
          <Plus className={iconSize} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-56 p-1"
        sideOffset={8}
      >
        {!submenu ? (
          /* Main menu */
          <div className="flex flex-col">
            <button
              className="flex items-center gap-2.5 px-3 py-2 text-xs text-foreground rounded-md hover:bg-muted/60 transition-colors"
              onClick={handleUpload}
            >
              <Upload className="w-3.5 h-3.5 text-muted-foreground" />
              Upload files or images
            </button>
            {onAttachItem && (
              <>
                <button
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-foreground rounded-md hover:bg-muted/60 transition-colors"
                  onClick={() => { setSubmenu("notes"); setTimeout(() => filterRef.current?.focus(), 50); }}
                >
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">Add notes</span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                </button>
                <button
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-foreground rounded-md hover:bg-muted/60 transition-colors"
                  onClick={() => { setSubmenu("tasks"); setTimeout(() => filterRef.current?.focus(), 50); }}
                >
                  <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">Add tasks</span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </>
            )}
          </div>
        ) : (
          /* Submenu: notes or tasks list with filter */
          <div className="flex flex-col">
            <button
              className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleBack}
            >
              <ChevronRight className="w-2.5 h-2.5 rotate-180" />
              {submenu === "notes" ? "Notes" : "Tasks"}
            </button>
            <div className="px-1.5 pb-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
                <Input
                  ref={filterRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${submenu}...`}
                  className="h-7 text-xs pl-7 bg-muted/30 border-border/30"
                />
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredItems.length === 0 && (
                <p className="text-[10px] text-muted-foreground/40 text-center py-3">
                  {filter ? "No matches" : `No ${submenu}`}
                </p>
              )}
              {filteredItems.map((item: any) => (
                <button
                  key={item.id}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left rounded-md hover:bg-muted/60 transition-colors"
                  onClick={() => handleSelect(item)}
                >
                  {submenu === "notes"
                    ? <FileText className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    : <CheckSquare className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  }
                  <span className="truncate text-foreground">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
