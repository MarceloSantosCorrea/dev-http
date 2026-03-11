import { randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "devhttp_session";
export const CSRF_COOKIE_NAME = "devhttp_csrf";
export const CLIENT_HEADER_NAME = "x-devhttp-client";
export const DESKTOP_CLIENT_VALUE = "desktop";
export const DESKTOP_SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
};

export type ResponseLike = {
  setHeader(name: string, value: string | string[]): void;
};

function toHeaderString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function parseCookieHeader(headerValue: string | string[] | undefined) {
  const source = toHeaderString(headerValue);
  if (!source) {
    return {};
  }

  return source.split(";").reduce<Record<string, string>>((cookies, chunk) => {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

export function getCookieValue(request: RequestLike, name: string) {
  return parseCookieHeader(request.headers.cookie)[name];
}

export function getBearerToken(request: RequestLike) {
  const authorization = toHeaderString(request.headers.authorization);
  return authorization.replace(/^Bearer\s+/i, "") || undefined;
}

export function getSessionToken(request: RequestLike) {
  return getCookieValue(request, SESSION_COOKIE_NAME) ?? getBearerToken(request);
}

export function getCsrfCookieToken(request: RequestLike) {
  return getCookieValue(request, CSRF_COOKIE_NAME);
}

export function getCsrfHeaderToken(request: RequestLike) {
  return toHeaderString(request.headers["x-csrf-token"]) || undefined;
}

export function isDesktopClient(request: RequestLike) {
  return toHeaderString(request.headers[CLIENT_HEADER_NAME]) === DESKTOP_CLIENT_VALUE;
}

export function isSafeMethod(method: string | undefined) {
  const normalized = String(method ?? "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

export function createCsrfToken() {
  return randomBytes(24).toString("hex");
}

function shouldUseSecureCookies() {
  return process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    path?: string;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
    maxAge?: number;
  } = {},
) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? "/"}`);
  segments.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.httpOnly) {
    segments.push("HttpOnly");
  }
  if (options.secure ?? shouldUseSecureCookies()) {
    segments.push("Secure");
  }
  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${options.maxAge}`);
  }
  return segments.join("; ");
}

export function buildAuthCookies(sessionToken: string, csrfToken: string, persistForDesktop = false) {
  return [
    serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      maxAge: persistForDesktop ? DESKTOP_SESSION_MAX_AGE_SECONDS : undefined,
    }),
    buildCsrfCookie(csrfToken, persistForDesktop),
  ];
}

export function buildCsrfCookie(csrfToken: string, persistForDesktop = false) {
  return serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
    maxAge: persistForDesktop ? DESKTOP_SESSION_MAX_AGE_SECONDS : undefined,
  });
}

export function buildClearedAuthCookies() {
  return [
    serializeCookie(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      maxAge: 0,
    }),
    serializeCookie(CSRF_COOKIE_NAME, "", {
      maxAge: 0,
    }),
  ];
}
