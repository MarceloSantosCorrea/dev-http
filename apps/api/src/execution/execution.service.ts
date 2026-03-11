import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  ConsoleValue,
  ExecutionResponse,
  FormDataField,
  RequestScriptLogEntry,
  Variable,
} from "@devhttp/shared";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { Script } from "node:vm";
import type { TLSSocket } from "node:tls";

import { StoreService } from "../store/store.service";
import { ExecuteRequestDto } from "./dto/execute-request.dto";

type TestCollector = Array<{ name: string; passed: boolean }>;

type PreparedBody = {
  bodyBuffer?: Buffer;
  consoleBody: ConsoleValue;
};

type PerformedRequest = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  network: ConsoleValue;
};

type SocketSnapshot = {
  localAddress: string | null;
  localFamily: string | null;
  localPort: number | null;
  remoteAddress: string | null;
  remoteFamily: string | null;
  remotePort: number | null;
};

type TlsSnapshot = {
  authorized: boolean;
  authorizationError: string | null;
  cipher: ConsoleValue;
  protocol: string | null;
  ephemeralKeyInfo: ConsoleValue;
  peerCertificate: ConsoleValue;
} | null;

@Injectable()
export class ExecutionService {
  constructor(@Inject(StoreService) private readonly store: StoreService) {}

  async execute(input: ExecuteRequestDto): Promise<ExecutionResponse> {
    const environment = await this.store.getEnvironment(input.environmentId);
    const variables = new Map<string, string>(
      (environment?.variables ?? [])
        .filter((variable) => variable.enabled)
        .map<[string, string]>((variable) => [variable.key, variable.value]),
    );

    const resolvedUrl = this.interpolate(input.url, variables);
    const searchParams = new URLSearchParams();
    for (const item of input.queryParams.filter((param) => param.enabled && param.key.trim())) {
      searchParams.append(item.key, this.interpolate(item.value, variables));
    }

    const url = new URL(resolvedUrl);
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }

    const headers = this.buildHeaders(input.headers, variables);
    const preparedBody = this.prepareBody(input, variables, headers);

    if (preparedBody.bodyBuffer && !headers["content-length"]) {
      headers["content-length"] = String(preparedBody.bodyBuffer.byteLength);
    }

    const startedAt = performance.now();
    const response = await this.performRequest({
      url,
      method: input.method,
      headers,
      bodyBuffer: preparedBody.bodyBuffer,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const bodyText = response.bodyBuffer.toString("utf8");

    let bodyJson: unknown;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = undefined;
    }

    const executionResponse: ExecutionResponse = {
      status: response.status,
      statusText: response.statusText,
      durationMs,
      headers: response.headers,
      bodyText,
      bodyJson,
      resolvedUrl: url.toString(),
      source: "server",
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
          "Response Body": bodyJson !== undefined ? this.normalizeConsoleValue(bodyJson) : bodyText,
        },
      },
    };

    if (input.postResponseScript?.trim()) {
      executionResponse.scriptResult = await this.runPostResponseScript(
        input.environmentId,
        input.postResponseScript,
        executionResponse,
        environment?.variables ?? [],
      );
      executionResponse.console.sections["Post-request Script"] = this.buildPostRequestScriptConsole(
        executionResponse.scriptResult,
      );
    }

    return executionResponse;
  }

  private buildHeaders(inputHeaders: ExecuteRequestDto["headers"], variables: Map<string, string>) {
    const headers: Record<string, string> = {};
    for (const item of inputHeaders.filter((header) => header.enabled && header.key.trim())) {
      headers[item.key.toLowerCase()] = this.interpolate(item.value, variables);
    }
    return headers;
  }

  private prepareBody(
    input: ExecuteRequestDto,
    variables: Map<string, string>,
    headers: Record<string, string>,
  ): PreparedBody {
    if (["GET", "HEAD"].includes(input.method)) {
      return { consoleBody: null };
    }

    if (input.bodyType === "form-data") {
      return this.prepareMultipartBody(input.formData ?? [], variables, headers);
    }

    const body = this.interpolate(input.body, variables);
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
      consoleBody: this.parseConsoleBody(body, input.bodyType === "json"),
    };
  }

  private prepareMultipartBody(
    fields: FormDataField[],
    variables: Map<string, string>,
    headers: Record<string, string>,
  ): PreparedBody {
    const enabledFields = fields.filter((entry) => entry.enabled && entry.key.trim());
    if (enabledFields.length === 0) {
      return { consoleBody: null };
    }

    const boundary = `----DevHttpBoundary${Math.random().toString(16).slice(2)}`;
    const chunks: Buffer[] = [];
    const consoleFields: Array<Record<string, ConsoleValue>> = [];

    for (const field of enabledFields) {
      const key = field.key;

      if (field.type === "file") {
        if (!field.src && !field.value) {
          throw new BadRequestException(
            `O campo de arquivo "${field.key}" ainda está pendente no form-data.`,
          );
        }

        const filename = this.interpolate(
          field.src || field.value || `${field.key}.txt`,
          variables,
        );
        const fileContent = this.interpolate(field.value || field.src || "", variables);
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

      const value = this.interpolate(field.value, variables);
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

  private async performRequest(input: {
    url: URL;
    method: ExecuteRequestDto["method"];
    headers: Record<string, string>;
    bodyBuffer?: Buffer;
  }): Promise<PerformedRequest> {
    const requestFn = input.url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const request = requestFn(
        input.url,
        {
          method: input.method,
          headers: input.headers,
        },
        (response) => {
          const socketSnapshot = this.captureSocketSnapshot(response.socket);
          const tlsSnapshot = this.captureTlsSnapshot(
            input.url.protocol === "https:" ? (response.socket as TLSSocket) : null,
          );
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? "",
              headers: this.normalizeHeaders(response.headers),
              bodyBuffer: Buffer.concat(chunks),
              network: this.buildNetworkConsole(socketSnapshot, tlsSnapshot, request.reusedSocket),
            });
          });
        },
      );

      request.on("error", (error) => {
        reject(new BadRequestException(error.message || "Falha ao executar request."));
      });

      request.setTimeout(30_000, () => {
        request.destroy(new Error("Timeout ao executar request."));
      });

      if (input.bodyBuffer) {
        request.write(input.bodyBuffer);
      }
      request.end();
    });
  }

  private normalizeHeaders(headers: IncomingHttpHeaders) {
    return Object.fromEntries(
      Object.entries(headers)
        .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
    );
  }

  private buildNetworkConsole(
    socket: SocketSnapshot,
    tlsSnapshot: TlsSnapshot,
    reusedSocket: boolean,
  ): ConsoleValue {
    return {
      addresses: {
        local: {
          address: socket.localAddress,
          family: socket.localFamily,
          port: socket.localPort,
        },
        remote: {
          address: socket.remoteAddress,
          family: socket.remoteFamily,
          port: socket.remotePort,
        },
      },
      tls: tlsSnapshot
        ? {
            reused: reusedSocket,
            ...tlsSnapshot,
          }
        : null,
    };
  }

  private captureSocketSnapshot(
    socket: {
      localAddress?: string;
      localFamily?: string;
      localPort?: number;
      remoteAddress?: string;
      remoteFamily?: string;
      remotePort?: number;
    } | null,
  ): SocketSnapshot {
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

  private captureTlsSnapshot(tlsSocket: TLSSocket | null): TlsSnapshot {
    if (!tlsSocket) {
      return null;
    }

    return {
      authorized: tlsSocket.authorized,
      authorizationError: tlsSocket.authorizationError
        ? String(tlsSocket.authorizationError)
        : null,
      cipher: this.normalizeConsoleValue(tlsSocket.getCipher?.() ?? null),
      protocol: tlsSocket.getProtocol?.() ?? null,
      ephemeralKeyInfo: this.normalizeConsoleValue(
        tlsSocket.getEphemeralKeyInfo?.() ?? {},
      ),
      peerCertificate: this.normalizeConsoleValue(
        this.sanitizePeerCertificate(tlsSocket.getPeerCertificate?.() ?? null),
      ),
    };
  }

  private sanitizePeerCertificate(value: unknown): ConsoleValue {
    if (!value || typeof value !== "object") {
      return this.normalizeConsoleValue(value);
    }

    const certificate = value as Record<string, unknown>;
    const sanitized = Object.fromEntries(
      Object.entries(certificate)
        .filter(([key, entry]) => key !== "raw" && key !== "pubkey" && key !== "issuerCertificate")
        .map(([key, entry]) => [key, this.normalizeConsoleValue(entry)]),
    );
    return sanitized;
  }

  private parseConsoleBody(body: string, parseJson: boolean): ConsoleValue {
    if (!body) {
      return null;
    }

    if (!parseJson) {
      return body;
    }

    try {
      return this.normalizeConsoleValue(JSON.parse(body));
    } catch {
      return body;
    }
  }

  private normalizeConsoleValue(value: unknown): ConsoleValue {
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
      return value.map((item) => this.normalizeConsoleValue(item));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry) => typeof entry[1] !== "function")
          .map(([key, entry]) => [key, this.normalizeConsoleValue(entry)]),
      );
    }

    return String(value);
  }

  private buildPostRequestScriptConsole(scriptResult: NonNullable<ExecutionResponse["scriptResult"]>): ConsoleValue {
    const section: Record<string, ConsoleValue> = {
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

  private async runPostResponseScript(
    environmentId: string | undefined,
    source: string,
    executionResponse: ExecutionResponse,
    currentVariables: Variable[],
  ) {
    const variableMap = new Map(currentVariables.map((variable) => [variable.key, variable]));
    const tests: TestCollector = [];
    const logs: RequestScriptLogEntry[] = [];
    const captureLog = (level: RequestScriptLogEntry["level"], args: unknown[]) => {
      logs.push({
        level,
        value:
          args.length <= 1
            ? this.normalizeConsoleValue(args[0])
            : this.normalizeConsoleValue(args),
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
        get: (name: string) => variableMap.get(name)?.value,
        set: (name: string, value: string) => {
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
        unset: (name: string) => {
          variableMap.delete(name);
        },
      },
      test: (name: string, passed: boolean) => {
        tests.push({ name, passed: Boolean(passed) });
      },
      console: {
        log: (...args: unknown[]) => captureLog("log", args),
        warn: (...args: unknown[]) => captureLog("warn", args),
        error: (...args: unknown[]) => captureLog("error", args),
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

    const updatedVariables = Array.from(variableMap.values());
    if (environmentId) {
      await this.store.upsertVariables(environmentId, updatedVariables);
    }

    return {
      tests,
      logs,
      updatedVariables,
    };
  }

  private interpolate(input: string, variables: Map<string, string>) {
    return input.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
      return variables.get(key.trim()) ?? "";
    });
  }
}
