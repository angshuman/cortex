import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizablePanelOptions {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey?: string;
  /** If true, dragging right DECREASES width (for right-side panels) */
  reverse?: boolean;
}

export function useResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  reverse = false,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) return parsed;
        }
      } catch {}
    }
    return defaultWidth;
  });

  const startX = useRef(0);
  const startWidth = useRef(0);
  const [isResizing, setIsResizing] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startWidth.current = width;
      setIsResizing(true);

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current;
        const newWidth = reverse
          ? startWidth.current - delta
          : startWidth.current + delta;
        // Clamp to the lesser of maxWidth or 50% of viewport
        const viewportMax = Math.floor(window.innerWidth * 0.5);
        const effectiveMax = Math.min(maxWidth, viewportMax);
        const clamped = Math.max(minWidth, Math.min(effectiveMax, newWidth));
        setWidth(clamped);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
        // Persist
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(width));
          } catch {}
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, minWidth, maxWidth, reverse, storageKey]
  );

  // Persist width to localStorage when it changes (debounced by mouseup above, but also on unmount)
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
    }
  }, [width, storageKey]);

  return { width, isResizing, onMouseDown };
}

export function ResizeHandle({
  onMouseDown,
  isResizing,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}) {
  return (
    <div
      className={`w-1.5 cursor-col-resize flex items-center justify-center shrink-0 transition-colors group
        ${isResizing ? "bg-primary/10" : "hover:bg-border/30"}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
    >
      <div
        className={`w-px h-full transition-colors
          ${isResizing ? "bg-primary/50" : "bg-border/20 group-hover:bg-border/60"}`}
      />
    </div>
  );
}
