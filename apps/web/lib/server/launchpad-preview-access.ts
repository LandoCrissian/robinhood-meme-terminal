import { createHash, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";

const maxWindowMs = 4 * 60 * 60 * 1_000;
const capabilityPattern = /^[0-9a-f]{64}$/;

export type LaunchpadPreviewAccess = {
  origin: URL;
  wallet: Address;
  accessCode: string;
  rpcPath: string;
  cookieValue: string;
  expiresAt: number;
};

export function readLaunchpadPreviewAccess(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): LaunchpadPreviewAccess | null {
  if (!env.RMT_LAUNCHPAD_PREVIEW_ORIGIN) return null;
  if (env.VERCEL === "1" || env.VERCEL_ENV || env.RMT_LAUNCHPAD_ENABLED !== "true" || env.RMT_LAUNCHPAD_CHAIN_ID !== "31337") {
    throw new Error("Preview access requires the isolated chain 31337 runtime.");
  }
  const origin = new URL(env.RMT_LAUNCHPAD_PREVIEW_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Set an exact HTTPS preview origin.");
  }
  const hostname = origin.hostname.replace(/\.$/, "");
  if (hostname === "rmtlaunch.fun" || hostname.endsWith(".rmtlaunch.fun")) {
    throw new Error("The production RMT domain is reserved.");
  }

  const { RMT_LAUNCHPAD_PREVIEW_ACCESS_CODE: accessCode, RMT_LAUNCHPAD_PREVIEW_RPC_CODE: rpcCode,
    RMT_LAUNCHPAD_PREVIEW_WALLET: wallet, RMT_LAUNCHPAD_PREVIEW_EXPIRES_AT: expiry } = env;
  if (!accessCode || !rpcCode || !capabilityPattern.test(accessCode) || !capabilityPattern.test(rpcCode) || accessCode === rpcCode) {
    throw new Error("Use separate random 256-bit preview access and RPC codes.");
  }
  const expiresAt = Number(expiry) * 1_000;
  if (!expiry || !/^\d{10}$/.test(expiry) || expiresAt <= now || expiresAt - now > maxWindowMs) {
    throw new Error("Set a preview expiration within four hours.");
  }
  if (!wallet || !isAddress(wallet) || getAddress(wallet) === zeroAddress) {
    throw new Error("Set the public address of the isolated test wallet.");
  }
  return {
    origin, wallet: getAddress(wallet), accessCode, rpcPath: `/preview-rpc/${rpcCode}`, expiresAt,
    cookieValue: createHash("sha256").update(`rmt-launch-preview:v1:${origin.origin}:${expiresAt}:${accessCode}`).digest("hex"),
  };
}

export function samePreviewCapability(received: string | undefined, expected: string) {
  return received !== undefined && received.length === expected.length
    && Buffer.byteLength(received) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
