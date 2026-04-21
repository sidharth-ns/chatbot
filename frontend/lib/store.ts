import { create } from "zustand";

interface AppState {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;

  streamId: string | null;
  setStreamId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  streamId: null,
  setStreamId: (id) => set({ streamId: id }),
}));
