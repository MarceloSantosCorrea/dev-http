import type { ExecutionResponse, LocalExecutionRequest } from "@devhttp/shared";

declare global {
  interface Window {
    devHttpDesktop?: {
      executeLocalRequest: (payload: LocalExecutionRequest) => Promise<ExecutionResponse>;
    };
  }
}

export {};
