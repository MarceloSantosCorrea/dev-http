import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";
import type { UserRealtimeEvent, WorkspaceRealtimeEvent } from "@devhttp/shared";

@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attachServer(server: Server) {
    this.server = server;
  }

  emitWorkspaceChanged(event: WorkspaceRealtimeEvent) {
    this.server?.to(this.getWorkspaceRoom(event.workspaceId)).emit("workspace.changed", event);
  }

  emitUserChanged(event: UserRealtimeEvent) {
    this.server?.to(this.getUserRoom(event.userId)).emit("user.changed", event);
  }

  getWorkspaceRoom(workspaceId: string) {
    return `workspace:${workspaceId}`;
  }

  getUserRoom(userId: string) {
    return `user:${userId}`;
  }
}
