import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@devhttp/shared"],
  allowedDevOrigins: ["192.168.0.*", "192.168.1.*"],
};

export default nextConfig;
