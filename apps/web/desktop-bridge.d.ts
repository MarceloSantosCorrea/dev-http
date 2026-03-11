import type { ExecutionResponse, LocalExecutionRequest } from "@devhttp/shared";

declare global {
  interface Window {
    devHttpDesktop?: {
      executeLocalRequest: (payload: LocalExecutionRequest) => Promise<ExecutionResponse>;
      getWorkspaceSnapshot: (userId: string) => Promise<unknown | null>;
      saveWorkspaceSnapshot: (userId: string, snapshot: unknown) => Promise<boolean>;
      clearWorkspaceSnapshot: (userId: string) => Promise<boolean>;
    };
  }
}

export {};
