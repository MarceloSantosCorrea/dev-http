const http = require("node:http");
const crypto = require("node:crypto");

const { executeRequestLocally } = require("@devhttp/local-executor");
const packageJson = require("./package.json");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 48100;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS =
  "https://devhttp.marcelocorrea.com.br,http://localhost:3000,http://127.0.0.1:3000";

function createAgentError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveAgentConfig(overrides = {}) {
  return {
    host: overrides.host || process.env.DEVHTTP_AGENT_HOST || DEFAULT_HOST,
    port: Number.parseInt(String(overrides.port || process.env.DEVHTTP_AGENT_PORT || DEFAULT_PORT), 10),
    allowedOrigins: new Set(
      (overrides.allowedOrigins || process.env.DEVHTTP_AGENT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  };
}

function createAgentServer(overrides = {}) {
  const config = resolveAgentConfig(overrides);
  const handshakeTokens = new Map();

  function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, session] of handshakeTokens.entries()) {
      if (session.expiresAt <= now) {
        handshakeTokens.delete(token);
      }
    }
  }

  function getOrigin(request) {
    return typeof request.headers.origin === "string" ? request.headers.origin : "";
  }

  function isOriginAllowed(origin) {
    return Boolean(origin) && config.allowedOrigins.has(origin);
  }

  function applyCorsHeaders(request, response) {
    const origin = getOrigin(request);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type,x-devhttp-agent-token");
    if (isOriginAllowed(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }
  }

  function writeJson(request, response, statusCode, payload) {
    applyCorsHeaders(request, response);
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  }

  function readJson(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;

      request.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > BODY_LIMIT_BYTES) {
          reject(new Error("O payload excedeu o limite suportado pelo DevHttp Agent."));
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });

      request.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8").trim();
        if (!rawBody) {
          resolve({});
          return;
        }

        try {
          resolve(JSON.parse(rawBody));
        } catch {
          reject(new Error("Payload JSON inválido enviado ao DevHttp Agent."));
        }
      });

      request.on("error", reject);
    });
  }

  async function handleHandshake(request, response) {
    const origin = getOrigin(request);
    if (!isOriginAllowed(origin)) {
      writeJson(request, response, 403, {
        message: "Origem não autorizada para usar o DevHttp Agent.",
        code: "ORIGIN_NOT_ALLOWED",
      });
      return;
    }

    cleanupExpiredTokens();

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    handshakeTokens.set(token, { origin, expiresAt });

    writeJson(request, response, 200, {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      version: packageJson.version,
    });
  }

  function validateHandshakeToken(request) {
    cleanupExpiredTokens();

    const origin = getOrigin(request);
    const token =
      typeof request.headers["x-devhttp-agent-token"] === "string"
        ? request.headers["x-devhttp-agent-token"]
        : "";

    if (!isOriginAllowed(origin)) {
      throw createAgentError("Origem não autorizada para usar o DevHttp Agent.", "ORIGIN_NOT_ALLOWED");
    }

    if (!token) {
      throw createAgentError("Token do DevHttp Agent ausente.", "TOKEN_MISSING");
    }

    const session = handshakeTokens.get(token);
    if (!session || session.origin !== origin || session.expiresAt <= Date.now()) {
      handshakeTokens.delete(token);
      throw createAgentError("Sessão do DevHttp Agent inválida ou expirada.", "SESSION_EXPIRED");
    }
  }

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      writeJson(request, response, 404, { message: "Rota não encontrada." });
      return;
    }

    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(getOrigin(request))) {
        writeJson(request, response, 403, {
          message: "Origem não autorizada para usar o DevHttp Agent.",
          code: "ORIGIN_NOT_ALLOWED",
        });
        return;
      }

      applyCorsHeaders(request, response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      writeJson(request, response, 200, {
        ok: true,
        name: "DevHttp Agent",
        version: packageJson.version,
        capabilities: ["execute-http"],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/handshake") {
      await handleHandshake(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/execute") {
      try {
        validateHandshakeToken(request);
        const payload = await readJson(request);
        const result = await executeRequestLocally({
          ...payload,
          source: "agent-local",
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        writeJson(request, response, 400, {
          message:
            error instanceof Error
              ? error.message
              : "Falha ao executar a request pelo DevHttp Agent.",
          code:
            error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : "EXECUTION_FAILED",
        });
      }
      return;
    }

    writeJson(request, response, 404, { message: "Rota não encontrada." });
  });

  return { server, config };
}

function startAgentServer(overrides = {}) {
  const { server, config } = createAgentServer(overrides);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve({ server, config });
    });
  });
}

function stopAgentServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

if (require.main === module) {
  let activeServer = null;

  startAgentServer()
    .then(({ server, config }) => {
      activeServer = server;
      console.log(`DevHttp Agent escutando em http://${config.host}:${config.port}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Falha ao iniciar o DevHttp Agent.");
      process.exit(1);
    });

  async function shutdown() {
    if (activeServer) {
      await stopAgentServer(activeServer);
    }
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  DEFAULT_AGENT_HOST: DEFAULT_HOST,
  DEFAULT_AGENT_PORT: DEFAULT_PORT,
  createAgentServer,
  startAgentServer,
  stopAgentServer,
};
