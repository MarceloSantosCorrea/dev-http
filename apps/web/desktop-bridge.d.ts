import type { ExecutionResponse, LocalExecutionRequest } from "@devhttp/shared";

declare global {
  interface Window {
    devHttpDesktop?: {
      executeLocalRequest: (payload: LocalExecutionRequest) => Promise<ExecutionResponse>;
      getWorkspaceSnapshot: (userId: string) => Promise<unknown | null>;
      saveWorkspaceSnapshot: (userId: string, snapshot: unknown) => Promise<boolean>;
      clearWorkspaceSnapshot: (userId: string) => Promise<boolean>;
      platform: string;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => void;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      beginTitleBarDrag: (payload: {
        screenX: number;
        screenY: number;
        clientX: number;
        clientY: number;
        viewportWidth: number;
      }) => Promise<boolean>;
      updateTitleBarDrag: (payload: {
        screenX: number;
        screenY: number;
      }) => Promise<boolean>;
      endTitleBarDrag: () => Promise<boolean>;
      setTitleBarTheme: (theme: "light" | "dark") => Promise<boolean>;
    };
  }
}

export {};
