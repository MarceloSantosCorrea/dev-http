import { Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import type { RequestLike } from "../auth/auth-http";
import { StoreService } from "../store/store.service";

@Controller("preferences")
export class PreferencesController {
  constructor(
    @Inject(StoreService)
    private readonly store: StoreService,
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Get()
  async get(@Req() request: RequestLike) {
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.getUserPreferences(user.id);
  }

  @Patch()
  async update(
    @Req() request: RequestLike,
    @Body() body: { sidebarCollapsed?: boolean; themeMode?: "light" | "dark" | "system" } = {},
  ) {
    this.authService.requireCsrf(request);
    const user = await this.authService.requireUserFromRequest(request);
    return this.store.saveUserPreferences(user.id, body);
  }
}
