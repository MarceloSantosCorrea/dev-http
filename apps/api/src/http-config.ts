function parseConfiguredOrigins() {
  return (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
