import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface VaultSettings {
  folderPath: string | null;
  browserHeadless: boolean;
  aiModel: string | null;
}

export interface Vault {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  settings: VaultSettings;
  createdAt: string;
  updatedAt: string;
}

interface VaultContextType {
  vaults: Vault[];
  activeVault: Vault | null;
  setActiveVaultId: (id: string) => void;
  isLoading: boolean;
  /** Returns the vault query param string to append to API URLs */
  vaultParam: string;
  /** Returns the vault ID for WebSocket messages */
  vaultId: string | undefined;
  refetchVaults: () => void;
}

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Store active vault ID in state (no localStorage — sandboxed iframe)
  const [activeVaultId, setActiveVaultIdState] = useState<string | null>(null);

  const { data: vaults = [], isLoading, refetch: refetchVaults } = useQuery<Vault[]>({
    queryKey: ["/api/vaults"],
    queryFn: () => apiRequest("GET", "/api/vaults").then(r => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Set default active vault once loaded
  useEffect(() => {
    if (vaults.length > 0 && !activeVaultId) {
      setActiveVaultIdState(vaults[0].id);
    }
    // If the current active vault was deleted, fall back to first
    if (activeVaultId && vaults.length > 0 && !vaults.find(v => v.id === activeVaultId)) {
      setActiveVaultIdState(vaults[0].id);
    }
  }, [vaults, activeVaultId]);

  const activeVault = vaults.find(v => v.id === activeVaultId) || null;

  const setActiveVaultId = useCallback((id: string) => {
    setActiveVaultIdState(id);
    // Invalidate all vault-scoped queries when switching vaults
    queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notes/folders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    queryClient.invalidateQueries({ queryKey: ["/api/search"] });
  }, [queryClient]);

  // Query param to append to all vault-scoped API calls
  const vaultParam = activeVaultId ? `?vault=${activeVaultId}` : "";

  return (
    <VaultContext.Provider
      value={{
        vaults,
        activeVault,
        setActiveVaultId,
        isLoading,
        vaultParam,
        vaultId: activeVaultId || undefined,
        refetchVaults: () => refetchVaults(),
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
