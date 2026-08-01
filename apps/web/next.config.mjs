import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(appDirectory, "../.."),
  webpack(config) {
    // MetaMask probes React Native storage and Privy probes Farcaster's Solana
    // adapter even though this app is an Ethereum-only browser terminal. Mark
    // those optional platform modules unavailable so actionable build warnings
    // are not hidden by integrations RMT cannot invoke.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "@farcaster/mini-app-solana": false
    };
    return config;
  }
};

export default nextConfig;
