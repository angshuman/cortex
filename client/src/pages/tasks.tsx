import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ChevronRight,
  Edit3,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

const statusConfig = {
  todo: { label: "To Do", color: "bg-zinc-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  done: { label: "Done", color: "bg-green-500" },
  archived: { label: "Archived", color: "bg-zinc-400" },
};

const priorityConfig = {
  low: { label: "Low", color: "text-zinc-400" },
  medium: { label: "Medium", color: "text-yellow-500" },
  high: { label: "High", color: "text-orange-500" },
  urgent: { label: "Urgent", color: "text-red-500" },
};

export default function TasksPage() {
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newParentId, setNewParentId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: () => apiRequest("GET", "/api/tasks").then(r => r.json()),
  });

  const createTask = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tasks", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setShowNewTask(false);
      setNewTitle("");
      setNewDesc("");
      setNewPriority("medium");
      setNewDueDate("");
      setNewParentId("");
      toast({ title: "Task created" });
    },
  });

  const updateTask = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/tasks/${id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setEditingTask(null);
      toast({ title: "Task deleted" });
    },
  });

  const toggleDone = (task: Task) => {
    updateTask.mutate({
      id: task.id,
      status: task.status === "done" ? "todo" : "done",
    });
  };

  const filteredTasks = tasks
    .filter(t => filterStatus === "all" || t.status === filterStatus)
    .sort((a, b) => a.order - b.order);

  const topLevelTasks = filteredTasks.filter(t => !t.parentId);
  const getSubtasks = (parentId: string) => filteredTasks.filter(t => t.parentId === parentId);

  const renderTaskCard = (task: Task, indent = 0) => {
    const subtasks = getSubtasks(task.id);
    const sc = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
    const pc = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.medium;

    return (
      <div key={task.id} style={{ marginLeft: indent * 20 }}>
        <div
          className={`group flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/50 transition-colors ${
            task.status === "done" ? "opacity-60" : ""
          }`}
          data-testid={`task-item-${task.id}`}
        >
          <Checkbox
            checked={task.status === "done"}
            onCheckedChange={() => toggleDone(task)}
            className="mt-0.5 shrink-0"
            data-testid={`checkbox-task-${task.id}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-sm ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {task.title}
              </span>
              <Flag className={`w-3 h-3 ${pc.color} shrink-0`} />
            </div>
            {task.description && (
              <p className="text-[11px] text-muted-foreground truncate">{task.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5">
                <span className={`w-1.5 h-1.5 rounded-full ${sc.color} mr-1`} />
                {sc.label}
              </Badge>
              {task.dueDate && (
                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" />
                  {new Date(task.dueDate).toLocaleDateString()}
                </span>
              )}
              {subtasks.length > 0 && (
                <span className="text-[9px] text-muted-foreground">
                  {subtasks.filter(s => s.status === "done").length}/{subtasks.length} subtasks
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => setEditingTask(task)}
          >
            <Edit3 className="w-3 h-3" />
          </Button>
        </div>
        {subtasks.map(st => renderTaskCard(st, indent + 1))}
      </div>
    );
  };

  const renderKanbanColumn = (status: string) => {
    const sc = statusConfig[status as keyof typeof statusConfig];
    const columnTasks = tasks
      .filter(t => t.status === status && !t.parentId)
      .sort((a, b) => a.order - b.order);

    return (
      <div key={status} className="flex-1 min-w-[260px] max-w-[320px]">
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className={`w-2 h-2 rounded-full ${sc.color}`} />
          <span className="text-xs font-medium">{sc.label}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">
            {columnTasks.length}
          </Badge>
        </div>
        <ScrollArea className="h-[calc(100vh-180px)]">
          <div className="space-y-1.5 pr-2">
            {columnTasks.map(task => {
              const pc = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.medium;
              const subtasks = getSubtasks(task.id);
              return (
                <Card
                  key={task.id}
                  className="p-3 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => setEditingTask(task)}
                  data-testid={`kanban-card-${task.id}`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={task.status === "done"}
                      onCheckedChange={(e) => {
                        e; // prevent card click
                        toggleDone(task);
                      }}
                      className="mt-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{task.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <Flag className={`w-2.5 h-2.5 ${pc.color}`} />
                        {task.dueDate && (
                          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <Calendar className="w-2.5 h-2.5" />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        {subtasks.length > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {subtasks.filter(s => s.status === "done").length}/{subtasks.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
            {columnTasks.length === 0 && (
              <div className="text-center py-8 text-[10px] text-muted-foreground/50">
                No tasks
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border/50 shrink-0">
        <SidebarTrigger />
        <CheckSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Tasks</span>
        <div className="ml-auto flex items-center gap-2">
          {view === "list" && (
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-7 text-xs w-28">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="todo">To Do</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          )}
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
          <Button size="sm" variant="default" className="text-xs gap-1" onClick={() => setShowNewTask(true)} data-testid="button-new-task">
            <Plus className="w-3.5 h-3.5" /> New Task
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {view === "kanban" ? (
          <div className="flex gap-4 h-full">
            {["todo", "in_progress", "done"].map(s => renderKanbanColumn(s))}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {topLevelTasks.length === 0 && (
              <div className="text-center py-16">
                <CheckSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No tasks yet. Create one to get started.</p>
              </div>
            )}
            {topLevelTasks.map(t => renderTaskCard(t))}
          </div>
        )}
      </div>

      {/* New task dialog */}
      <Dialog open={showNewTask} onOpenChange={setShowNewTask}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="text-sm"
              data-testid="input-new-task-title"
            />
            <Textarea
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="input-new-task-desc"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={newPriority} onValueChange={setNewPriority}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="text-sm"
              />
            </div>
            {tasks.filter(t => !t.parentId).length > 0 && (
              <Select value={newParentId} onValueChange={setNewParentId}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Parent task (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No parent</SelectItem>
                  {tasks.filter(t => !t.parentId).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              className="w-full text-sm"
              onClick={() => createTask.mutate({
                title: newTitle || "Untitled Task",
                description: newDesc,
                priority: newPriority,
                dueDate: newDueDate || null,
                parentId: newParentId && newParentId !== "none" ? newParentId : null,
              })}
              data-testid="button-create-task"
            >
              Create Task
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit task dialog */}
      <Dialog open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)}>
        {editingTask && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Edit Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                className="text-sm"
                data-testid="input-edit-task-title"
              />
              <Textarea
                value={editingTask.description}
                onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                className="text-sm min-h-[60px]"
              />
              <div className="grid grid-cols-2 gap-2">
                <Select value={editingTask.status} onValueChange={(v) => setEditingTask({ ...editingTask, status: v })}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={editingTask.priority} onValueChange={(v) => setEditingTask({ ...editingTask, priority: v })}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 text-sm"
                  onClick={() => {
                    updateTask.mutate({
                      id: editingTask.id,
                      title: editingTask.title,
                      description: editingTask.description,
                      status: editingTask.status,
                      priority: editingTask.priority,
                    });
                    setEditingTask(null);
                    toast({ title: "Task updated" });
                  }}
                  data-testid="button-update-task"
                >
                  Save
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => deleteTask.mutate(editingTask.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
