import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, withVault } from "@/lib/queryClient";
import { useVault } from "@/hooks/use-vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckSquare,
  Plus,
  Trash2,
  Calendar,
  Flag,
  LayoutGrid,
  List,
  Edit3,
  X,
  MessageSquare,
  GripVertical,
  Circle,
  Clock,
  CheckCircle2,
  Archive,
  ChevronRight,
  Save,
  Tag,
  MoreHorizontal,
  XCircle,
  Filter,
  Check,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextChat, type ContextItem } from "@/components/context-chat";
import { ResizeHandle, useResizablePanel } from "@/components/resize-handle";
import { useToast } from "@/hooks/use-toast";
import { marked } from "@/lib/marked-config";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  parentId: string | null;
  tags: string[];
  dueDate: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const statusConfig: Record<string, { label: string; icon: typeof Circle; color: string; bgColor: string }> = {
  todo: { label: "To Do", icon: Circle, color: "text-zinc-400", bgColor: "bg-zinc-400" },
  in_progress: { label: "In Progress", icon: Clock, color: "text-amber-500", bgColor: "bg-amber-500" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-500", bgColor: "bg-emerald-500" },
  closed: { label: "Closed", icon: XCircle, color: "text-violet-500", bgColor: "bg-violet-500" },
  archived: { label: "Archived", icon: Archive, color: "text-zinc-500", bgColor: "bg-zinc-500" },
};

const KANBAN_STATUSES = ["todo", "in_progress", "done", "closed"] as const;
const DEFAULT_VISIBLE_STATUSES = ["todo", "in_progress", "done"];

const priorityConfig: Record<string, { label: string; color: string; dotColor: string }> = {
  low: { label: "Low", color: "text-zinc-400", dotColor: "bg-zinc-400" },
  medium: { label: "Medium", color: "text-yellow-500", dotColor: "bg-yellow-500" },
  high: { label: "High", color: "text-orange-500", dotColor: "bg-orange-500" },
  urgent: { label: "Urgent", color: "text-red-500", dotColor: "bg-red-500" },
};

// ============ Sortable Task Card (for kanban) ============
function SortableTaskCard({
  task,
  onOpen,
  onToggle,
  subtaskCount,
  subtaskDone,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  subtaskCount: number;
  subtaskDone: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task, type: "task" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const pc = priorityConfig[task.priority] || priorityConfig.medium;
  const sc = statusConfig[task.status] || statusConfig.todo;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-lg border border-border/50 bg-card p-3 card-hover cursor-pointer"
      onClick={() => onOpen(task)}
      data-testid={`kanban-card-${task.id}`}
    >
      <div className="flex items-start gap-2">
        <div
          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <Checkbox
          checked={task.status === "done"}
          onCheckedChange={() => onToggle(task)}
          className="mt-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
          data-testid={`checkbox-task-${task.id}`}
        />
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-medium leading-tight ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
              {task.description.replace(/[#*_`\[\]]/g, "").slice(0, 120)}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className={`w-1.5 h-1.5 rounded-full ${pc.dotColor} shrink-0`} />
            {task.dueDate && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Calendar className="w-2.5 h-2.5" />
                {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
            {task.tags.length > 0 && task.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">
                {tag}
              </Badge>
            ))}
            {subtaskCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {subtaskDone}/{subtaskCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Droppable Kanban Column ============
function KanbanColumn({
  status,
  tasks,
  allTasks,
  onOpen,
  onToggle,
  onAddTask,
}: {
  status: string;
  tasks: Task[];
  allTasks: Task[];
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onAddTask: (status: string) => void;
}) {
  const sc = statusConfig[status] || statusConfig.todo;
  const StatusIcon = sc.icon;
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status}` });

  return (
    <div className="flex-1 min-w-[280px] max-w-[360px] flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <StatusIcon className={`w-4 h-4 ${sc.color}`} />
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{sc.label}</span>
        <span className="text-[10px] text-muted-foreground/60 ml-0.5">{tasks.length}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 ml-auto text-muted-foreground/50 hover:text-foreground"
          onClick={() => onAddTask(status)}
          data-testid={`button-add-task-${status}`}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-lg transition-colors ${isOver ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
      >
        <ScrollArea className="h-[calc(100vh-180px)]">
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 pr-2 pb-8">
              {tasks.map((task) => {
                const subtasks = allTasks.filter(t => t.parentId === task.id);
                return (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    onOpen={onOpen}
                    onToggle={onToggle}
                    subtaskCount={subtasks.length}
                    subtaskDone={subtasks.filter(s => s.status === "done").length}
                  />
                );
              })}
              {tasks.length === 0 && (
                <div className="text-center py-8">
                  <StatusIcon className={`w-5 h-5 ${sc.color} opacity-20 mx-auto mb-1.5`} />
                  <p className="text-[11px] text-muted-foreground/30">No tasks</p>
                </div>
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
}

// ============ Task Detail Slide-Over ============
function TaskDetailPanel({
  task,
  allTasks,
  open,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task | null;
  allTasks: Task[];
  open: boolean;
  onClose: () => void;
  onUpdate: (data: any) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editTags, setEditTags] = useState("");

  const startEditing = useCallback(() => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditStatus(task.status);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || "");
    setEditTags(task.tags.join(", "));
    setEditing(true);
  }, [task]);

  const handleSave = () => {
    if (!task) return;
    onUpdate({
      id: task.id,
      title: editTitle,
      description: editDesc,
      status: editStatus,
      priority: editPriority,
      dueDate: editDueDate || null,
      tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
    });
    setEditing(false);
  };

  if (!task) return null;

  const sc = statusConfig[task.status] || statusConfig.todo;
  const pc = priorityConfig[task.priority] || priorityConfig.medium;
  const StatusIcon = sc.icon;
  const subtasks = allTasks.filter(t => t.parentId === task.id);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setEditing(false); onClose(); } }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg p-0 flex flex-col overflow-hidden border-l border-border/50"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{task.title}</SheetTitle>
          <SheetDescription>Task details</SheetDescription>
        </SheetHeader>

        {/* Header */}
        <div className="flex items-center gap-2 px-5 h-14 border-b border-border/50 shrink-0">
          <StatusIcon className={`w-4 h-4 ${sc.color} shrink-0`} />
          <span className="text-xs text-muted-foreground">{sc.label}</span>
          <div className="ml-auto flex items-center gap-1">
            {!editing ? (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={startEditing} data-testid="button-edit-task">
                  <Edit3 className="w-3 h-3" /> Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {Object.entries(statusConfig).map(([key, cfg]) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => onUpdate({ id: task.id, status: key })}
                        className="text-xs gap-2"
                      >
                        <cfg.icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        Move to {cfg.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(task.id)}
                      className="text-xs text-destructive gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} data-testid="button-save-task">
                  <Save className="w-3 h-3" /> Save
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1">
          <div className="px-5 py-5 space-y-5">
            {/* Title */}
            {editing ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-base font-semibold border-0 bg-transparent px-0 focus-visible:ring-0 h-auto"
                placeholder="Task title"
                data-testid="input-edit-task-title"
              />
            ) : (
              <h2 className={`text-base font-semibold ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                {task.title}
              </h2>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Status</label>
                {editing ? (
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusConfig).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          <span className="flex items-center gap-1.5">
                            <cfg.icon className={`w-3 h-3 ${cfg.color}`} />
                            {cfg.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <StatusIcon className={`w-3.5 h-3.5 ${sc.color}`} />
                    <span className="text-xs">{sc.label}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Priority</label>
                {editing ? (
                  <Select value={editPriority} onValueChange={setEditPriority}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(priorityConfig).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          <span className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
                            {cfg.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Flag className={`w-3.5 h-3.5 ${pc.color}`} />
                    <span className="text-xs">{pc.label}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Due Date</label>
                {editing ? (
                  <Input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="h-8 text-xs"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "No date"}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Tags</label>
                {editing ? (
                  <Input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="tag1, tag2"
                    className="h-8 text-xs"
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {task.tags.length > 0 ? task.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1">
                        <Tag className="w-2 h-2" />{tag}
                      </Badge>
                    )) : (
                      <span className="text-xs text-muted-foreground">No tags</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Description</label>
              {editing ? (
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Add a description (supports markdown)..."
                  className="min-h-[200px] text-sm font-mono resize-none"
                  data-testid="input-edit-task-desc"
                />
              ) : task.description ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-sm [&_img]:rounded-lg [&_img]:max-w-full [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:text-xs"
                  dangerouslySetInnerHTML={{ __html: marked.parse(task.description) as string }}
                />
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">No description</p>
              )}
            </div>

            {/* Subtasks */}
            {subtasks.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                  Subtasks ({subtasks.filter(s => s.status === "done").length}/{subtasks.length})
                </label>
                <div className="space-y-1">
                  {subtasks.map((st) => (
                    <div key={st.id} className="flex items-center gap-2 py-1">
                      <Checkbox
                        checked={st.status === "done"}
                        onCheckedChange={() => onUpdate({ id: st.id, status: st.status === "done" ? "todo" : "done" })}
                        className="shrink-0"
                      />
                      <span className={`text-xs ${st.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {st.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="border-t border-border/30 pt-4 space-y-1">
              <p className="text-[10px] text-muted-foreground/50">Created {new Date(task.createdAt).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground/50">Updated {new Date(task.updatedAt).toLocaleString()}</p>
              {task.completedAt && (
                <p className="text-[10px] text-muted-foreground/50">Completed {new Date(task.completedAt).toLocaleString()}</p>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ============ Main Tasks Page ============
export default function TasksPage() {
  const [view, setView] = useState<"list" | "kanban">("list");
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_STATUSES));
  const [chatOpen, setChatOpen] = useState(true);
  const chatPanel = useResizablePanel({ defaultWidth: 420, minWidth: 280, maxWidth: 800, storageKey: "cortex-tasks-chat-width", reverse: true });
  const [activeId, setActiveId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { vaultParam, vaultId } = useVault();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks", vaultId],
    queryFn: () => apiRequest("GET", withVault("/api/tasks", vaultParam)).then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !!vaultId,
  });

  const createTask = useMutation({
    mutationFn: (data: any) => apiRequest("POST", withVault("/api/tasks", vaultParam), data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task created" });
    },
  });

  const updateTask = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", withVault(`/api/tasks/${id}`, vaultParam), data).then(r => r.json()),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      // Update detail panel if same task
      if (detailTask && updated && (updated as Task).id === detailTask.id) {
        setDetailTask(updated as Task);
      }
    },
  });

  const reorderTasks = useMutation({
    mutationFn: (data: { taskIds: string[] }) => apiRequest("POST", withVault("/api/tasks/reorder", vaultParam), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", withVault(`/api/tasks/${id}`, vaultParam)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setDetailTask(null);
      toast({ title: "Task deleted" });
    },
  });

  // Sync detailTask from fresh query data (e.g. after AI updates the task)
  useEffect(() => {
    if (!detailTask) return;
    const fresh = tasks.find(t => t.id === detailTask.id);
    if (!fresh) return;
    if (fresh.updatedAt !== detailTask.updatedAt) {
      setDetailTask(fresh);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDone = useCallback((task: Task) => {
    updateTask.mutate({
      id: task.id,
      status: task.status === "done" ? "todo" : "done",
    });
  }, [updateTask]);

  const toggleFilterStatus = useCallback((status: string) => {
    setFilterStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        // Don't allow empty — keep at least one
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // Organize tasks by status for kanban (only show columns for active filters)
  const tasksByStatus = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    for (const s of KANBAN_STATUSES) {
      if (filterStatuses.has(s)) groups[s] = [];
    }
    tasks
      .filter(t => !t.parentId && filterStatuses.has(t.status))
      .sort((a, b) => a.order - b.order)
      .forEach(t => {
        if (groups[t.status]) groups[t.status].push(t);
      });
    return groups;
  }, [tasks, filterStatuses]);

  const filteredTasks = useMemo(() =>
    tasks
      .filter(t => filterStatuses.has(t.status))
      .sort((a, b) => a.order - b.order),
    [tasks, filterStatuses]
  );

  const topLevelTasks = filteredTasks.filter(t => !t.parentId);
  const getSubtasks = (parentId: string) => filteredTasks.filter(t => t.parentId === parentId);

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask) return;

    // Determine target column
    let targetStatus: string | null = null;
    const overId = over.id as string;

    if (overId.startsWith("column-")) {
      targetStatus = overId.replace("column-", "");
    } else {
      const overTask = tasks.find(t => t.id === overId);
      if (overTask) targetStatus = overTask.status;
    }

    if (!targetStatus) return;

    // If status changed, update the task
    if (activeTask.status !== targetStatus) {
      updateTask.mutate({ id: activeTask.id, status: targetStatus });
    }

    // Reorder within column
    const columnTasks = tasks
      .filter(t => !t.parentId && (t.id === activeTask.id ? targetStatus : t.status) === targetStatus)
      .sort((a, b) => a.order - b.order);

    const oldIndex = columnTasks.findIndex(t => t.id === activeTask.id);
    const overTask = tasks.find(t => t.id === overId);
    const newIndex = overTask ? columnTasks.findIndex(t => t.id === overTask.id) : columnTasks.length - 1;

    if (oldIndex !== newIndex && newIndex >= 0) {
      const reordered = [...columnTasks];
      const [moved] = reordered.splice(oldIndex, 1);
      if (moved) reordered.splice(newIndex, 0, moved);
      reorderTasks.mutate({ taskIds: reordered.map(t => t.id) });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // No-op — we handle everything in dragEnd
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleAddTaskInColumn = (status: string) => {
    createTask.mutate({ title: "Untitled Task", status });
  };

  // ============ LIST VIEW ROW ============
  const renderListRow = (task: Task, indent = 0) => {
    const subtasks = getSubtasks(task.id);
    const sc = statusConfig[task.status] || statusConfig.todo;
    const pc = priorityConfig[task.priority] || priorityConfig.medium;
    const StatusIcon = sc.icon;

    return (
      <div key={task.id} style={{ paddingLeft: indent * 24 }}>
        <div
          className="group flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
          onClick={() => setDetailTask(task)}
          data-testid={`task-item-${task.id}`}
        >
          <Checkbox
            checked={task.status === "done"}
            onCheckedChange={() => toggleDone(task)}
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            data-testid={`checkbox-task-${task.id}`}
          />
          <StatusIcon className={`w-3.5 h-3.5 ${sc.color} shrink-0`} />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className={`text-[13px] font-medium truncate ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {task.title}
            </span>
            {task.description && (
              <>
                <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                <span className="text-[11px] text-muted-foreground/50 truncate">
                  {task.description.replace(/[#*_`\[\]]/g, "").slice(0, 60)}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${pc.dotColor}`} title={pc.label} />
            {task.tags.length > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal">
                {task.tags[0]}{task.tags.length > 1 ? ` +${task.tags.length - 1}` : ""}
              </Badge>
            )}
            {task.dueDate && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Calendar className="w-2.5 h-2.5" />
                {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
            {subtasks.length > 0 && (
              <span className="text-[10px] text-muted-foreground/50">
                {subtasks.filter(s => s.status === "done").length}/{subtasks.length}
              </span>
            )}
          </div>
        </div>
        {subtasks.map(st => renderListRow(st, indent + 1))}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <CheckSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Tasks</span>
        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
                <Filter className="w-3 h-3" />
                <span>Filter</span>
                {filterStatuses.size < Object.keys(statusConfig).length && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 font-normal ml-0.5">
                    {filterStatuses.size}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              {Object.entries(statusConfig).map(([key, cfg]) => {
                const isSelected = filterStatuses.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleFilterStatus(key)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md hover:bg-muted/60 transition-colors"
                    data-testid={`filter-status-${key}`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                      isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border"
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <cfg.icon className={`w-3 h-3 ${cfg.color}`} />
                    <span className="flex-1 text-left">{cfg.label}</span>
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
          <div className="flex rounded-md border border-border/50">
            <Button
              size="sm"
              variant={view === "kanban" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 rounded-r-none"
              onClick={() => setView("kanban")}
            >
              <LayoutGrid className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 rounded-l-none"
              onClick={() => setView("list")}
            >
              <List className="w-3 h-3" />
            </Button>
          </div>
          <Button
            size="sm"
            variant={chatOpen ? "secondary" : "ghost"}
            className="text-xs gap-1"
            onClick={() => setChatOpen(!chatOpen)}
            data-testid="button-toggle-chat"
          >
            <MessageSquare className="w-3.5 h-3.5" /> AI
          </Button>
          <Button
            size="sm"
            variant="default"
            className="text-xs gap-1"
            onClick={() => createTask.mutate({ title: "Untitled Task" })}
            data-testid="button-new-task"
          >
            <Plus className="w-3.5 h-3.5" /> New Task
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-auto p-4">
          {view === "kanban" ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
            >
              <div className="flex gap-4 h-full">
                {Object.keys(tasksByStatus).map(status => (
                  <KanbanColumn
                    key={status}
                    status={status}
                    tasks={tasksByStatus[status] || []}
                    allTasks={tasks}
                    onOpen={setDetailTask}
                    onToggle={toggleDone}
                    onAddTask={handleAddTaskInColumn}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeTask ? (
                  <div className="rounded-lg border border-primary/30 bg-card p-3 shadow-lg w-[280px] opacity-90">
                    <p className="text-[13px] font-medium">{activeTask.title}</p>
                    {activeTask.description && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                        {activeTask.description.slice(0, 60)}
                      </p>
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="max-w-3xl mx-auto">
              {topLevelTasks.length === 0 && (
                <div className="text-center py-16">
                  <CheckSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No tasks yet. Create one to get started.</p>
                </div>
              )}
              {topLevelTasks.map(t => renderListRow(t))}
            </div>
          )}
        </div>

        {/* Context-aware AI chat panel */}
        {chatOpen && <ResizeHandle onMouseDown={chatPanel.onMouseDown} isResizing={chatPanel.isResizing} />}
        <ContextChat
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          width={chatPanel.width}
          context={filteredTasks.filter(t => t.status !== "archived").slice(0, 20).map(t => ({
            type: "task" as const,
            title: t.title,
            content: `Status: ${t.status} | Priority: ${t.priority}${t.description ? " | " + t.description : ""}${t.dueDate ? " | Due: " + t.dueDate : ""}`,
            id: t.id,
          }))}
          placeholder="Ask about your tasks..."
        />
      </div>


      {/* Task detail slide-over */}
      <TaskDetailPanel
        task={detailTask}
        allTasks={tasks}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        onUpdate={(data) => updateTask.mutate(data)}
        onDelete={(id) => deleteTask.mutate(id)}
      />
    </div>
  );
}
