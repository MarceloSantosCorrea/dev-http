import { Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { StoreService } from "../store/store.service";

@Controller("users")
export class UsersController {
  constructor(
    @Inject(StoreService)
    private readonly store: StoreService,
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Get("me")
  async getProfile(@Req() request: RequestLike) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.getUserProfile(user.id);
  }

  @Patch("me")
  async updateProfile(
    @Req() request: RequestLike,
    @Body()
    body: {
      name?: string;
      email?: string;
      avatarUrl?: string | null;
    } = {},
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.updateUserProfile(user.id, {
      name: String(body.name ?? user.name),
      email: String(body.email ?? user.email),
      avatarUrl: body.avatarUrl ?? null,
    });
  }

  @Patch("me/password")
  async changePassword(
    @Req() request: RequestLike,
    @Body()
    body: {
      currentPassword?: string;
      newPassword?: string;
    } = {},
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.changePassword(
      user.id,
      String(body.currentPassword ?? ""),
      String(body.newPassword ?? ""),
    );
  }
}
