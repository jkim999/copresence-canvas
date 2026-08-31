import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  body: string;
  detail?: string[];
  confirmLabel: string;
  cancelLabel: string;
}

interface ConfirmState {
  pending: (ConfirmRequest & { id: string }) | null;
  resolve: ((ok: boolean) => void) | null;
  answer: (ok: boolean) => void;
  request: (req: ConfirmRequest) => Promise<boolean>;
}

/**
 * Human-in-the-loop gate for the one destructive whole-board action.
 * WebMCP has no standard elicitation API today, so the page owns the
 * confirmation: the tool handler simply awaits the human's answer.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  resolve: null,
  answer: (ok) => {
    const { resolve } = get();
    set({ pending: null, resolve: null });
    resolve?.(ok);
  },
  request: (req) =>
    new Promise<boolean>((resolve) => {
      const previous = get().resolve;
      previous?.(false);
      set({
        pending: { ...req, id: `c_${Date.now().toString(36)}` },
        resolve,
      });
    }),
}));
