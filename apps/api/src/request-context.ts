import { AsyncLocalStorage } from "node:async_hooks";

type RealtimeRequestContext = {
  originInstanceId?: string;
};

const requestContextStorage = new AsyncLocalStorage<RealtimeRequestContext>();

export function runWithRequestContext<T>(
  context: RealtimeRequestContext,
  callback: () => T,
) {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext() {
  return requestContextStorage.getStore() ?? {};
}
