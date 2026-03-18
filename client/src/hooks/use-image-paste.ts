import { useState, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface PendingImage {
  id: string;
  file: File;
  preview: string; // data URL for preview
  uploading: boolean;
  uploaded?: { url: string; mediaType: string };
  error?: string;
}

export function useImagePaste() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const idCounter = useRef(0);

  const addImage = useCallback(async (file: File) => {
    const id = `img-${++idCounter.current}-${Date.now()}`;
    const preview = URL.createObjectURL(file);

    setPendingImages(prev => [...prev, { id, file, preview, uploading: true }]);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "pasted-image.png");
      const res = await fetch("/api/chat/assets", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      setPendingImages(prev =>
        prev.map(img =>
          img.id === id
            ? { ...img, uploading: false, uploaded: { url: data.url, mediaType: file.type || "image/png" } }
            : img
        )
      );
    } catch (err: any) {
      setPendingImages(prev =>
        prev.map(img =>
          img.id === id ? { ...img, uploading: false, error: err.message } : img
        )
      );
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setPendingImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter(i => i.id !== id);
    });
  }, []);

  const clearImages = useCallback(() => {
    setPendingImages(prev => {
      prev.forEach(img => URL.revokeObjectURL(img.preview));
      return [];
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) addImage(file);
      }
    }
  }, [addImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) {
        addImage(files[i]);
      }
    }
  }, [addImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Get all successfully uploaded images
  const uploadedImages = pendingImages
    .filter(img => img.uploaded)
    .map(img => img.uploaded!);

  const hasImages = pendingImages.length > 0;
  const allUploaded = pendingImages.length > 0 && pendingImages.every(img => img.uploaded);
  const isUploading = pendingImages.some(img => img.uploading);

  return {
    pendingImages,
    uploadedImages,
    hasImages,
    allUploaded,
    isUploading,
    addImage,
    removeImage,
    clearImages,
    handlePaste,
    handleDrop,
    handleDragOver,
  };
}
