export function parseConfiguredOrigins() {
  return (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const LOCAL_NETWORK_PATTERN = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function isOriginAllowed(origin: string, configured: string[]): boolean {
  if (configured.length > 0) {
    return configured.includes(origin);
  }

  if (["http://localhost:3000", "http://127.0.0.1:3000"].includes(origin)) {
    return true;
  }

  return LOCAL_NETWORK_PATTERN.test(origin);
}

export function getAllowedOrigins() {
  const configured = parseConfiguredOrigins();
  if (configured.length > 0) {
    return configured;
  }

  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

export function getSocketIoPath() {
  return "/api/socket.io";
}
