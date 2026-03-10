import type { ExecutionResponse, LocalExecutionRequest } from "@devhttp/shared";

const LOCAL_AGENT_BASE_URL =
  process.env.NEXT_PUBLIC_LOCAL_AGENT_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:48100";

export const LOCAL_AGENT_REQUIRED_MESSAGE =
  "Destino local detectado. Instale ou inicie o DevHttp Agent para acessar localhost e rede privada no navegador.";

type AgentHandshakeResponse = {
  token: string;
  expiresAt: string;
  version: string;
};

export async function connectLocalAgent() {
  try {
    const healthResponse = await fetch(`${LOCAL_AGENT_BASE_URL}/health`, {
      method: "GET",
    });
    if (!healthResponse.ok) {
      return { available: false, token: "" };
    }

    const handshakeResponse = await fetch(`${LOCAL_AGENT_BASE_URL}/handshake`, {
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

export async function executeLocalAgentRequest(
  token: string,
  payload: LocalExecutionRequest,
): Promise<ExecutionResponse> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/execute`, {
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
      const parsed = JSON.parse(text) as { message?: string };
      throw new Error(parsed.message || "Falha ao executar request pelo DevHttp Agent.");
    } catch {
      throw new Error(text || "Falha ao executar request pelo DevHttp Agent.");
    }
  }

  return (await response.json()) as ExecutionResponse;
}
