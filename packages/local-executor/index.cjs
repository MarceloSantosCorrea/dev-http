const { request: httpRequest } = require("node:http");
const { request: httpsRequest } = require("node:https");
const { Script } = require("node:vm");

function executeRequestLocally(input) {
  const variables = new Map(
    (input.variables ?? [])
      .filter((variable) => variable.enabled)
      .map((variable) => [variable.key, variable.value]),
  );

  const resolvedUrl = interpolate(input.url, variables);
  const searchParams = new URLSearchParams();
  for (const item of (input.queryParams ?? []).filter((param) => param.enabled && param.key.trim())) {
    searchParams.append(item.key, interpolate(item.value, variables));
  }

  const url = new URL(resolvedUrl);
  for (const [key, value] of searchParams.entries()) {
    url.searchParams.append(key, value);
  }

  const headers = buildHeaders(input.headers ?? [], variables);
  const preparedBody = prepareBody(input, variables, headers);

  if (preparedBody.bodyBuffer && !headers["content-length"]) {
    headers["content-length"] = String(preparedBody.bodyBuffer.byteLength);
  }

  const startedAt = performance.now();
  return performRequest({
    url,
    method: input.method,
    headers,
    bodyBuffer: preparedBody.bodyBuffer,
  }).then((response) => {
    const durationMs = Math.round(performance.now() - startedAt);
    const bodyText = response.bodyBuffer.toString("utf8");

    let bodyJson;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = undefined;
    }

    const executionResponse = {
      status: response.status,
      statusText: response.statusText,
      durationMs,
      headers: response.headers,
      bodyText,
      bodyJson,
      resolvedUrl: url.toString(),
      source: input.source ?? "desktop-local",
      console: {
        requestLine: `${input.method} ${url.toString()}`,
        sections: {
          Network: response.network,
          "Request Headers": {
            ...headers,
            ":path": `${url.pathname}${url.search}`,
            ":method": input.method,
            ":authority": url.host,
            ":scheme": url.protocol.replace(":", ""),
          },
          "Request Body": preparedBody.consoleBody,
          "Response Headers": {
            ":status": response.status,
            ...response.headers,
          },
          "Response Body": bodyJson !== undefined ? normalizeConsoleValue(bodyJson) : bodyText,
        },
      },
    };

    if (!input.postResponseScript || !input.postResponseScript.trim()) {
      return executionResponse;
    }

    executionResponse.scriptResult = runPostResponseScript(
      input.postResponseScript,
      executionResponse,
      input.variables ?? [],
    );
    executionResponse.console.sections["Post-request Script"] = buildPostRequestScriptConsole(
      executionResponse.scriptResult,
    );
    return executionResponse;
  });
}

function buildHeaders(inputHeaders, variables) {
  const headers = {};
  for (const item of inputHeaders.filter((header) => header.enabled && header.key.trim())) {
    headers[item.key.toLowerCase()] = interpolate(item.value, variables);
  }
  return headers;
}

function prepareBody(input, variables, headers) {
  if (["GET", "HEAD"].includes(input.method)) {
    return { consoleBody: null };
  }

  if (input.bodyType === "form-data") {
    return prepareMultipartBody(input.formData ?? [], variables, headers);
  }

  const body = interpolate(input.body ?? "", variables);
  if (!body) {
    return { consoleBody: null };
  }

  if (input.bodyType === "json" && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  if (input.bodyType === "form-urlencoded" && !headers["content-type"]) {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  return {
    bodyBuffer: Buffer.from(body, "utf8"),
    consoleBody: parseConsoleBody(body, input.bodyType === "json"),
  };
}

function prepareMultipartBody(fields, variables, headers) {
  const enabledFields = fields.filter((entry) => entry.enabled && entry.key.trim());
  if (enabledFields.length === 0) {
    return { consoleBody: null };
  }

  const boundary = `----DevHttpBoundary${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const consoleFields = [];

  for (const field of enabledFields) {
    const key = field.key;

    if (field.type === "file") {
      if (!field.src && !field.value) {
        throw new Error(`O campo de arquivo "${field.key}" ainda está pendente no form-data.`);
      }

      const filename = interpolate(field.src || field.value || `${field.key}.txt`, variables);
      const fileContent = interpolate(field.value || field.src || "", variables);
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
            "Content-Type: text/plain\r\n\r\n" +
            `${fileContent}\r\n`,
          "utf8",
        ),
      );
      consoleFields.push({
        key,
        type: "file",
        filename,
        value: fileContent,
      });
      continue;
    }

    const value = interpolate(field.value, variables);
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
    consoleFields.push({
      key,
      type: "text",
      value,
    });
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  headers["content-type"] = `multipart/form-data; boundary=${boundary}`;

  return {
    bodyBuffer: Buffer.concat(chunks),
    consoleBody: {
      type: "form-data",
      fields: consoleFields,
    },
  };
}

function performRequest(input) {
  const requestFn = input.url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = requestFn(
      input.url,
      {
        method: input.method,
        headers: input.headers,
      },
      (response) => {
        const socketSnapshot = captureSocketSnapshot(response.socket);
        const tlsSnapshot = captureTlsSnapshot(
          input.url.protocol === "https:" ? response.socket : null,
        );
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: normalizeHeaders(response.headers),
            bodyBuffer: Buffer.concat(chunks),
            network: buildNetworkConsole(socketSnapshot, tlsSnapshot, request.reusedSocket),
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("A requisição local excedeu o tempo limite de 30s."));
    });

    if (input.bodyBuffer) {
      request.write(input.bodyBuffer);
    }

    request.end();
  });
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]),
  );
}

function buildNetworkConsole(socket, tlsSnapshot, reusedSocket) {
  const network = {
    addresses: {
      local: socket.localAddress
        ? {
            address: socket.localAddress,
            family: socket.localFamily,
            port: socket.localPort,
          }
        : null,
      remote: socket.remoteAddress
        ? {
            address: socket.remoteAddress,
            family: socket.remoteFamily,
            port: socket.remotePort,
          }
        : null,
    },
  };

  if (!tlsSnapshot) {
    return network;
  }

  return {
    ...network,
    tls: {
      reused: Boolean(reusedSocket),
      ...tlsSnapshot,
    },
  };
}

function captureSocketSnapshot(socket) {
  const localAddress = socket?.localAddress ?? null;
  const remoteAddress = socket?.remoteAddress ?? null;

  return {
    localAddress,
    localFamily:
      socket?.localFamily ?? (localAddress ? (localAddress.includes(":") ? "IPv6" : "IPv4") : null),
    localPort: socket?.localPort ?? null,
    remoteAddress,
    remoteFamily:
      socket?.remoteFamily ?? (remoteAddress ? (remoteAddress.includes(":") ? "IPv6" : "IPv4") : null),
    remotePort: socket?.remotePort ?? null,
  };
}

function captureTlsSnapshot(tlsSocket) {
  if (!tlsSocket || typeof tlsSocket.getCipher !== "function") {
    return null;
  }

  return {
    authorized: tlsSocket.authorized,
    authorizationError: tlsSocket.authorizationError ?? null,
    cipher: normalizeConsoleValue(tlsSocket.getCipher()),
    protocol: tlsSocket.getProtocol?.() ?? null,
    ephemeralKeyInfo: normalizeConsoleValue(tlsSocket.getEphemeralKeyInfo?.() ?? {}),
    peerCertificate: normalizeConsoleValue(tlsSocket.getPeerCertificate?.(true) ?? null),
  };
}

function parseConsoleBody(body, tryParseJson) {
  if (!body) {
    return null;
  }

  if (tryParseJson) {
    try {
      return normalizeConsoleValue(JSON.parse(body));
    } catch {
      return body;
    }
  }

  return body;
}

function normalizeConsoleValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeConsoleValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => typeof entry[1] !== "function")
        .map(([key, entry]) => [key, normalizeConsoleValue(entry)]),
    );
  }

  return String(value);
}

function buildPostRequestScriptConsole(scriptResult) {
  const section = {
    Logs: scriptResult.logs,
    Tests: scriptResult.tests.map((test) => ({
      name: test.name,
      passed: test.passed,
    })),
  };

  if (scriptResult.error) {
    section.Error = scriptResult.error;
  }

  return section;
}

function runPostResponseScript(source, executionResponse, currentVariables) {
  const variableMap = new Map(currentVariables.map((variable) => [variable.key, { ...variable }]));
  const tests = [];
  const logs = [];
  const captureLog = (level, args) => {
    logs.push({
      level,
      value: args.length <= 1 ? normalizeConsoleValue(args[0]) : normalizeConsoleValue(args),
    });
  };

  const sandbox = {
    response: {
      status: executionResponse.status,
      headers: executionResponse.headers,
      body: executionResponse.bodyText,
      json: () => executionResponse.bodyJson,
    },
    env: {
      get: (name) => variableMap.get(name)?.value,
      set: (name, value) => {
        const existing = variableMap.get(name);
        if (existing) {
          existing.value = value;
          existing.enabled = true;
          return;
        }

        variableMap.set(name, {
          key: name,
          value,
          enabled: true,
        });
      },
      unset: (name) => {
        variableMap.delete(name);
      },
    },
    test: (name, passed) => {
      tests.push({ name, passed: Boolean(passed) });
    },
    console: {
      log: (...args) => captureLog("log", args),
      warn: (...args) => captureLog("warn", args),
      error: (...args) => captureLog("error", args),
    },
  };

  try {
    const script = new Script(source);
    script.runInNewContext(sandbox, {
      timeout: 250,
    });
  } catch (error) {
    return {
      tests,
      logs,
      updatedVariables: Array.from(variableMap.values()),
      error: error instanceof Error ? error.message : "Falha ao executar script.",
    };
  }

  return {
    tests,
    logs,
    updatedVariables: Array.from(variableMap.values()),
  };
}

function interpolate(input, variables) {
  return String(input ?? "").replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    return variables.get(key.trim()) ?? "";
  });
}

module.exports = {
  executeRequestLocally,
};
