import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";

import { StoreService } from "../store/store.service";
import {
  buildAuthCookies,
  buildCsrfCookie,
  buildClearedAuthCookies,
  createCsrfToken,
  getCsrfCookieToken,
  isDesktopClient,
  type RequestLike,
  type ResponseLike,
} from "./auth-http";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(StoreService)
    private readonly store: StoreService,
  ) {}

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.authService.login(body.email, body.password);
    const csrfToken = createCsrfToken();
    response.setHeader(
      "Set-Cookie",
      buildAuthCookies(result.token ?? "", csrfToken, isDesktopClient(request)),
    );
    return {
      user: result.user,
      workspaceId: result.workspaceId,
      workspaces: result.workspaces,
    };
  }

  @Post("register")
  async register(
    @Body() body: RegisterDto,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.store.register(body);
    const csrfToken = createCsrfToken();
    response.setHeader(
      "Set-Cookie",
      buildAuthCookies(result.token ?? "", csrfToken, isDesktopClient(request)),
    );
    return {
      user: result.user,
      workspaceId: result.workspaceId,
      workspaces: result.workspaces,
    };
  }

  @Post("logout")
  async logout(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    this.authService.requireCsrf(request);
    await this.authService.logoutFromRequest(request);
    response.setHeader("Set-Cookie", buildClearedAuthCookies());
    return { loggedOut: true };
  }

  @Get("me")
  async me(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const user = await this.authService.requireUserFromRequest(request);
    const workspaces = await this.store.listWorkspacesForUser(user.id);
    if (!getCsrfCookieToken(request)) {
      response.setHeader("Set-Cookie", buildCsrfCookie(createCsrfToken(), isDesktopClient(request)));
    }
    return {
      user,
      workspaceId: workspaces[0]?.workspace.id ?? "",
      workspaces,
    };
  }
}
