import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(appDirectory, "../.."),
  transpilePackages: ["@rmt/shared"],
  async redirects() {
    return [
      {
        source: "/terminal.html",
        destination: "/",
        permanent: true
      },
      {
        source: "/vnext",
        destination: "/",
        permanent: true
      }
    ];
  },
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
    if (process.env.NEXT_PUBLIC_RMT_PRIVY_BRIDGE_ACCEPTANCE_PROFILE === "true") {
      config.resolve.alias["@privy-io/react-auth"] = path.resolve(
        appDirectory,
        "lib/testing/privy-react-auth-acceptance.tsx"
      );
      config.resolve.alias["@privy-io/wagmi"] = path.resolve(
        appDirectory,
        "lib/testing/privy-wagmi-acceptance.tsx"
      );
    }
    // @rmt/shared publishes raw TypeScript with Node ESM `.js` sibling
    // specifiers. Limit the TypeScript fallback to that package's source;
    // application and dependency resolution retain Webpack's defaults.
    config.module.rules.push({
      include: [
        path.resolve(appDirectory, "../../packages/shared/src"),
        /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@rmt[\\/]shared[\\/]src[\\/]/
      ],
      resolve: {
        extensionAlias: {
          ".js": [".ts", ".tsx", ".js"]
        }
      }
    });
    return config;
  }
};

export default nextConfig;
