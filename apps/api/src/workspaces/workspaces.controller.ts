import { Controller, Get, Inject, Param, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { StoreService } from "../store/store.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(StoreService)
    private readonly store: StoreService,
  ) {}

  @Get(":workspaceId/bootstrap")
  async bootstrap(
    @Param("workspaceId") workspaceId: string,
    @Req() request: RequestLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.getBootstrap(user.id, workspaceId);
  }
}
