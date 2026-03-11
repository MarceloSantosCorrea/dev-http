import type { ExecutionResponse, LocalExecutionRequest } from "@devhttp/shared";

const LOCAL_AGENT_BASE_URL =
  process.env.NEXT_PUBLIC_LOCAL_AGENT_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:48100";

export const LOCAL_AGENT_REQUIRED_MESSAGE =
  "Destino local detectado. Instale ou inicie o DevHttp Agent para acessar localhost e rede privada no navegador.";

const LOCAL_AGENT_SESSION_EXPIRED_CODE = "SESSION_EXPIRED";

type AgentHandshakeResponse = {
  token: string;
  expiresAt: string;
  version: string;
};

type AgentErrorPayload = {
  message?: string;
  code?: string;
};

type LocalAgentErrorKind = "agent_required" | "agent_session_expired" | "agent_request_failed";

export class LocalAgentError extends Error {
  kind: LocalAgentErrorKind;
  code?: string;

  constructor(kind: LocalAgentErrorKind, message: string, code?: string) {
    super(message);
    this.name = "LocalAgentError";
    this.kind = kind;
    this.code = code;
  }
}

type LocalAgentExecutionResult = {
  response: ExecutionResponse;
  token: string;
};

export function isLocalAgentRequiredError(error: unknown): error is LocalAgentError {
  return error instanceof LocalAgentError && error.kind === "agent_required";
}

async function requestAgent(path: string, init: RequestInit) {
  try {
    return await fetch(`${LOCAL_AGENT_BASE_URL}${path}`, init);
  } catch {
    throw new LocalAgentError("agent_required", LOCAL_AGENT_REQUIRED_MESSAGE);
  }
}

export async function connectLocalAgent() {
  try {
    const healthResponse = await requestAgent("/health", {
      method: "GET",
    });
    if (!healthResponse.ok) {
      return { available: false, token: "" };
    }

    const handshakeResponse = await requestAgent("/handshake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!handshakeResponse.ok) {
      return { available: false, token: "" };
    }

    const payload = (await handshakeResponse.json()) as AgentHandshakeResponse;
    return { available: true, token: payload.token };
  } catch {
    return { available: false, token: "" };
  }
}

async function executeLocalAgentRequestOnce(
  token: string,
  payload: LocalExecutionRequest,
): Promise<ExecutionResponse> {
  const response = await requestAgent("/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-devhttp-agent-token": token,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as AgentErrorPayload;
      if (parsed.code === LOCAL_AGENT_SESSION_EXPIRED_CODE) {
        throw new LocalAgentError(
          "agent_session_expired",
          parsed.message || "Sessão do DevHttp Agent inválida ou expirada.",
          parsed.code,
        );
      }

      throw new LocalAgentError(
        "agent_request_failed",
        parsed.message || "Falha ao executar request pelo DevHttp Agent.",
        parsed.code,
      );
    } catch (error) {
      if (error instanceof LocalAgentError) {
        throw error;
      }
      throw new LocalAgentError("agent_request_failed", text || "Falha ao executar request pelo DevHttp Agent.");
    }
  }

  return (await response.json()) as ExecutionResponse;
}

export async function executeLocalAgentRequest(
  token: string,
  payload: LocalExecutionRequest,
): Promise<ExecutionResponse> {
  return executeLocalAgentRequestOnce(token, payload);
}

export async function executeLocalAgentRequestWithRetry(
  token: string,
  payload: LocalExecutionRequest,
): Promise<LocalAgentExecutionResult> {
  let nextToken = token;

  if (!nextToken) {
    const connection = await connectLocalAgent();
    if (!connection.available || !connection.token) {
      throw new LocalAgentError("agent_required", LOCAL_AGENT_REQUIRED_MESSAGE);
    }
    nextToken = connection.token;
  }

  try {
    const response = await executeLocalAgentRequestOnce(nextToken, payload);
    return {
      response,
      token: nextToken,
    };
  } catch (error) {
    if (!(error instanceof LocalAgentError) || error.kind !== "agent_session_expired") {
      throw error;
    }

    const connection = await connectLocalAgent();
    if (!connection.available || !connection.token) {
      throw new LocalAgentError("agent_required", LOCAL_AGENT_REQUIRED_MESSAGE);
    }

    const response = await executeLocalAgentRequestOnce(connection.token, payload);
    return {
      response,
      token: connection.token,
    };
  }
}
