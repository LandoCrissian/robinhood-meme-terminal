import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(appDirectory, "../.."),
  webpack(config) {
    // These imports are optional upstream branches that are unreachable in
    // RMT's browser runtime. MetaMask uses localStorage on the web, while
    // pino-pretty is a development-only logger transport. Resolving them to
    // empty modules keeps the wallet bundle honest without shipping React
    // Native storage or a server-side pretty printer to users.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false
    };
    return config;
  }
};

export default nextConfig;
