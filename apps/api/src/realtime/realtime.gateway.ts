import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { type Server, type Socket } from "socket.io";

import { getSessionToken, type RequestLike } from "../auth/auth-http";
import { StoreService } from "../store/store.service";
import { RealtimeService } from "./realtime.service";

function toRequestLike(socket: Socket): RequestLike {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(socket.handshake.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value;
      continue;
    }

    headers[key] = value === undefined ? undefined : String(value);
  }
  return {
    headers,
    method: "GET",
  };
}

@Injectable()
@WebSocketGateway({
  path: "/api/socket.io",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    @Inject(StoreService)
    private readonly store: StoreService,
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attachServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const request = toRequestLike(client);
      const user = await this.store.validateToken(getSessionToken(request));
      if (!user) {
        client.disconnect(true);
        return;
      }

      client.data.userId = user.id;
      client.join(this.realtime.getUserRoom(user.id));

      const workspaces = await this.store.listWorkspacesForUser(user.id);
      for (const membership of workspaces) {
        client.join(this.realtime.getWorkspaceRoom(membership.workspace.id));
      }
    } catch (error) {
      this.logger.warn(
        `Falha ao autenticar socket realtime: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
      client.disconnect(true);
    }
  }
}
