import { useState, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Reset on open
  useEffect(() => {
    if (open) {
      setScale(1);
      setRotation(0);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.25, 5)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.25, 0.25)), []);
  const rotate = useCallback(() => setRotation(r => (r + 90) % 360), []);

  // Scroll to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setScale(s => Math.min(s + 0.1, 5));
    } else {
      setScale(s => Math.max(s - 0.1, 0.25));
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1 z-[101]"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={zoomIn}
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={zoomOut}
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={rotate}
          title="Rotate"
        >
          <RotateCw className="w-4 h-4" />
        </Button>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={onClose}
          title="Close"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Scale indicator */}
      {scale !== 1 && (
        <div className="absolute top-4 left-4 text-white/50 text-xs z-[101]">
          {Math.round(scale * 100)}%
        </div>
      )}

      {/* Image */}
      <img
        src={src}
        alt={alt || ""}
        className="max-w-[90vw] max-h-[90vh] object-contain select-none cursor-zoom-in transition-transform duration-150"
        style={{
          transform: `scale(${scale}) rotate(${rotation}deg)`,
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        draggable={false}
      />

      {/* Alt text */}
      {alt && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs max-w-md truncate z-[101]">
          {alt}
        </div>
      )}
    </div>
  );
}

/**
 * Hook to add lightbox behavior to all images inside a container.
 * Returns the lightbox state + a click handler to attach to the container.
 */
export function useImageLightbox() {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      // Don't open tiny icons/badges
      if (img.naturalWidth < 50 && img.naturalHeight < 50) return;
      e.preventDefault();
      setLightbox({ src: img.src, alt: img.alt || "" });
    }
  }, []);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  return { lightbox, handleContainerClick, closeLightbox };
}
