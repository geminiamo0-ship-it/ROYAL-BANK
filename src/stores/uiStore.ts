import { create } from 'zustand';

interface UIState {
  isSidebarOpen: boolean;
  isUpgradeModalOpen: boolean;
  activePathwayId: number | null;
  activePathwaySlug: string;

  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
  setActivePathway: (id: number | null, slug?: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  isUpgradeModalOpen: false,
  activePathwayId: 1,
  activePathwaySlug: 'mrcp-part-1',

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  openUpgradeModal: () => set({ isUpgradeModalOpen: true }),
  closeUpgradeModal: () => set({ isUpgradeModalOpen: false }),
  setActivePathway: (id, slug = 'mrcp-part-1') => set({ activePathwayId: id, activePathwaySlug: slug }),
}));
