import { defaultEnvironments, defaultProjects } from "@/lib/default-data";
import {
  ApiConnectionInfo,
  Environment,
  Project,
  RequestDraft,
  ResponseSnapshot,
  WorkspaceData,
} from "@/lib/types";
import {
  buildRequestUrl,
  getBodyPayload,
  inferBodyFormat,
  normalizeBodyForDisplay,
  resolveRequest,
} from "@/lib/request-utils";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  return baseUrl ? stripTrailingSlash(baseUrl) : null;
}

function isProjectArray(value: unknown): value is Project[] {
  return Array.isArray(value);
}

function isEnvironmentArray(value: unknown): value is Environment[] {
  return Array.isArray(value);
}

function toConnection(
  state: ApiConnectionInfo["state"],
  message: string,
  baseUrl: string | null,
): ApiConnectionInfo {
  return { state, message, baseUrl };
}

async function fetchJson<T>(input: string): Promise<T | null> {
  const response = await fetch(input, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    return {
      projects: defaultProjects,
      environments: defaultEnvironments,
      connection: toConnection(
        "mock",
        "NEXT_PUBLIC_API_BASE_URL não configurado. Interface operando com dados locais.",
        null,
      ),
    };
  }

  try {
    const workspace = await fetchJson<{
      projects?: Project[];
      environments?: Environment[];
    }>(`${baseUrl}/workspace`);

    if (workspace?.projects && workspace?.environments) {
      return {
        projects: isProjectArray(workspace.projects) ? workspace.projects : defaultProjects,
        environments: isEnvironmentArray(workspace.environments)
          ? workspace.environments
          : defaultEnvironments,
        connection: toConnection("connected", "Dados carregados da API REST.", baseUrl),
      };
    }

    const [projects, environments] = await Promise.all([
      fetchJson<Project[]>(`${baseUrl}/projects`),
      fetchJson<Environment[]>(`${baseUrl}/environments`),
    ]);

    if (projects || environments) {
      return {
        projects: projects && isProjectArray(projects) ? projects : defaultProjects,
        environments:
          environments && isEnvironmentArray(environments)
            ? environments
            : defaultEnvironments,
        connection: toConnection(
          "connected",
          "Dados carregados via endpoints /projects e /environments.",
          baseUrl,
        ),
      };
    }
  } catch {
    return {
      projects: defaultProjects,
      environments: defaultEnvironments,
      connection: toConnection(
        "mock",
        "Falha ao alcançar a API REST. Interface operando com fallback local.",
        baseUrl,
      ),
    };
  }

  return {
    projects: defaultProjects,
    environments: defaultEnvironments,
    connection: toConnection(
      "mock",
      "API REST sem endpoints de workspace compatíveis. Fallback local ativo.",
      baseUrl,
    ),
  };
}

function getHeaderValue(
  headers: Array<{ key: string; value: string }>,
  key: string,
): string | null {
  const match = headers.find((header) => header.key.toLowerCase() === key.toLowerCase());

  return match?.value ?? null;
}

function getTextSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

class ProxyUnavailableError extends Error {}

async function executeViaBrowser(request: RequestDraft, environment?: Environment | null) {
  const resolved = resolveRequest(request, environment);
  const requestedUrl = buildRequestUrl(resolved.url, resolved.queryParams);
  const headers = Object.fromEntries(resolved.headers.map((header) => [header.key, header.value]));
  const startedAt = performance.now();

  const response = await fetch(requestedUrl, {
    method: resolved.method,
    headers,
    body:
      resolved.method === "GET" || resolved.method === "HEAD"
        ? undefined
        : getBodyPayload(resolved.bodyMode, resolved.body),
  });

  const text = await response.text();
  const durationMs = performance.now() - startedAt;
  const responseHeaders = Array.from(response.headers.entries()).map(([key, value]) => ({
    key,
    value,
  }));
  const bodyFormat = inferBodyFormat(getHeaderValue(responseHeaders, "content-type"), text);
  const body = normalizeBodyForDisplay(bodyFormat, text);

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    durationMs,
    sizeBytes: getTextSize(body),
    headers: responseHeaders,
    body,
    bodyFormat,
    source: "browser" as const,
    requestedUrl,
  };
}

function normalizeProxyResponse(payload: unknown, fallbackUrl: string): ResponseSnapshot | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as {
    response?: Partial<ResponseSnapshot>;
    status?: number;
    statusText?: string;
    durationMs?: number;
    sizeBytes?: number;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    requestedUrl?: string;
    source?: "proxy" | "browser";
  };

  const source = data.response?.source ?? data.source ?? "proxy";
  const status = data.response?.status ?? data.status;
  const statusText = data.response?.statusText ?? data.statusText ?? "";
  const durationMs = data.response?.durationMs ?? data.durationMs ?? 0;
  const body = data.response?.body ?? data.body ?? "";
  const headers = data.response?.headers ?? data.headers ?? [];
  const requestedUrl = data.response?.requestedUrl ?? data.requestedUrl ?? fallbackUrl;

  if (typeof status !== "number") {
    return null;
  }

  const bodyFormat = inferBodyFormat(getHeaderValue(headers, "content-type"), body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    durationMs,
    sizeBytes: data.response?.sizeBytes ?? data.sizeBytes ?? getTextSize(body),
    headers,
    body: normalizeBodyForDisplay(bodyFormat, body),
    bodyFormat,
    source,
    requestedUrl,
  };
}

async function executeViaProxy(
  request: RequestDraft,
  environment: Environment | null | undefined,
  baseUrl: string,
): Promise<ResponseSnapshot> {
  const resolved = resolveRequest(request, environment);
  const requestedUrl = buildRequestUrl(resolved.url, resolved.queryParams);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/requests/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request: {
          ...resolved,
          url: requestedUrl,
        },
        environmentId: environment?.id ?? null,
      }),
    });
  } catch {
    throw new ProxyUnavailableError("REST proxy indisponível.");
  }

  const rawPayload = await response.text();

  if (response.status === 404 || response.status === 405) {
    throw new ProxyUnavailableError("Endpoint /requests/execute não disponível.");
  }

  if (!response.ok) {
    throw new Error(rawPayload || `Proxy execution failed with status ${response.status}.`);
  }

  let payload: unknown = rawPayload;
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      throw new ProxyUnavailableError("Proxy retornou JSON inválido.");
    }
  }

  const normalized = normalizeProxyResponse(payload, requestedUrl);

  if (!normalized) {
    throw new ProxyUnavailableError("Proxy retornou payload incompatível.");
  }

  return normalized;
}

export async function executeRequest(
  request: RequestDraft,
  environment?: Environment | null,
): Promise<ResponseSnapshot> {
  const baseUrl = getApiBaseUrl();

  if (baseUrl) {
    try {
      return await executeViaProxy(request, environment, baseUrl);
    } catch (error) {
      if (!(error instanceof ProxyUnavailableError)) {
        throw error;
      }
    }
  }

  return executeViaBrowser(request, environment);
}
