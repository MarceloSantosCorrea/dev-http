import { Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";

import { AuthService } from "./auth/auth.service";
import type { RequestLike } from "./auth/auth-http";
import { StoreService } from "./store/store.service";

@Controller("notifications")
export class NotificationsController {
  constructor(
    @Inject(StoreService)
    private readonly store: StoreService,
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Get()
  async list(@Req() request: RequestLike) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.listNotifications(user.id);
  }

  @Post(":notificationId/read")
  async markAsRead(
    @Param("notificationId") notificationId: string,
    @Req() request: RequestLike,
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.markNotificationAsRead(user.id, notificationId);
  }
}
