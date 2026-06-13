import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Caddy proxies https://finances.lan → localhost:3200, so HMR/dev-fetch
  // requests carry the LAN hostname as their Origin. Whitelist it.
  allowedDevOrigins: ["finances.lan"],
  // The Agent SDK spawns the bundled `claude` binary as a subprocess and must
  // not be bundled by the compiler — keep it external on the server.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
