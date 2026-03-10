import {
  Environment,
  KeyValueRow,
  RequestDraft,
  ResolvedRequest,
} from "@/lib/types";

export function createRow(seed = ""): KeyValueRow {
  return {
    id: `row-${seed}-${Math.random().toString(36).slice(2, 9)}`,
    key: "",
    value: "",
    enabled: true,
  };
}

export function cloneDraft(draft: RequestDraft): RequestDraft {
  return {
    ...draft,
    queryParams: draft.queryParams.map((row) => ({ ...row })),
    headers: draft.headers.map((row) => ({ ...row })),
  };
}

function interpolateValue(value: string, environment?: Environment | null): string {
  if (!environment) {
    return value;
  }

  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, token: string) => {
    const match = environment.variables.find(
      (variable) => variable.enabled && variable.key === token,
    );

    return match ? match.value : "";
  });
}

function normalizeRows(
  rows: KeyValueRow[],
  environment?: Environment | null,
): KeyValueRow[] {
  return rows
    .filter((row) => row.enabled && row.key.trim().length > 0)
    .map((row) => ({
      ...row,
      key: interpolateValue(row.key, environment).trim(),
      value: interpolateValue(row.value, environment),
    }));
}

export function resolveRequest(
  draft: RequestDraft,
  environment?: Environment | null,
): ResolvedRequest {
  return {
    method: draft.method,
    url: interpolateValue(draft.url, environment).trim(),
    queryParams: normalizeRows(draft.queryParams, environment),
    headers: normalizeRows(draft.headers, environment),
    bodyMode: draft.bodyMode,
    body: interpolateValue(draft.body, environment),
  };
}

export function buildRequestUrl(
  baseUrl: string,
  queryParams: KeyValueRow[],
): string {
  const url = new URL(baseUrl);

  for (const row of queryParams) {
    url.searchParams.set(row.key, row.value);
  }

  return url.toString();
}

export function formatBody(bodyMode: RequestDraft["bodyMode"], value: string): string {
  if (bodyMode !== "json") {
    return value;
  }

  if (!value.trim()) {
    return "";
  }

  return JSON.stringify(JSON.parse(value), null, 2);
}

export function getBodyPayload(bodyMode: RequestDraft["bodyMode"], body: string): string {
  if (!body.trim()) {
    return "";
  }

  if (bodyMode === "json") {
    return JSON.stringify(JSON.parse(body));
  }

  return body;
}

export function inferBodyFormat(
  contentType: string | null,
  body: string,
): "json" | "text" {
  if (contentType?.includes("application/json")) {
    return "json";
  }

  if (!body.trim()) {
    return "text";
  }

  try {
    JSON.parse(body);
    return "json";
  } catch {
    return "text";
  }
}

export function normalizeBodyForDisplay(
  bodyFormat: "json" | "text",
  body: string,
): string {
  if (bodyFormat !== "json" || !body.trim()) {
    return body;
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
