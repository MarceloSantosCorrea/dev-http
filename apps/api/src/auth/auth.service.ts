import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { StoreService } from "../store/store.service";
import {
  getCsrfCookieToken,
  getCsrfHeaderToken,
  getCookieValue,
  getSessionToken,
  isSafeMethod,
  type RequestLike,
} from "./auth-http";

@Injectable()
export class AuthService {
  constructor(@Inject(StoreService) private readonly store: StoreService) {}

  async login(email: string, password: string) {
    return this.store.login(email, password);
  }

  async logout(headerValue?: string) {
    const token = headerValue?.replace(/^Bearer\s+/i, "");
    return this.store.logout(token);
  }

  async logoutFromRequest(request: RequestLike) {
    return this.store.logout(getSessionToken(request));
  }

  async requireUserFromRequest(request: RequestLike) {
    const user = await this.store.validateToken(getSessionToken(request));
    if (!user) {
      throw new UnauthorizedException("Token inválido ou ausente.");
    }

    return user;
  }

  requireCsrf(request: RequestLike) {
    if (isSafeMethod(request.method)) {
      return;
    }

    const sessionCookie = getCookieValue(request, "devhttp_session");
    if (!sessionCookie) {
      return;
    }

    const csrfCookie = getCsrfCookieToken(request);
    const csrfHeader = getCsrfHeaderToken(request);
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException("Token CSRF inválido ou ausente.");
    }
  }

  async requireUserFromHeader(headerValue?: string) {
    const token = headerValue?.replace(/^Bearer\s+/i, "");
    const user = await this.store.validateToken(token);
    if (!user) {
      throw new UnauthorizedException("Token inválido ou ausente.");
    }

    return user;
  }
}
