"use client";

import { io, type Socket } from "socket.io-client";
import type { UserRealtimeEvent, WorkspaceRealtimeEvent } from "@devhttp/shared";

function resolveSocketTarget(apiBaseUrl: string) {
  const base = new URL(apiBaseUrl, window.location.origin);
  return {
    origin: base.origin,
    path: "/api/socket.io",
  };
}

export function createRealtimeSocket(apiBaseUrl: string) {
  const target = resolveSocketTarget(apiBaseUrl);
  return io(target.origin, {
    path: target.path,
    withCredentials: true,
    transports: ["websocket", "polling"],
  }) as Socket<{
    "workspace.changed": (event: WorkspaceRealtimeEvent) => void;
    "user.changed": (event: UserRealtimeEvent) => void;
    connect: () => void;
    disconnect: (reason: string) => void;
  }>;
}
