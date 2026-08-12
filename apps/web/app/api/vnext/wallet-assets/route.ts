import { getAddress, isAddress } from "viem";
import {
  MAX_WALLET_DISCOVERY_ASSETS,
  parseBlockscoutWalletAssets,
  type VNextWalletDiscoveryResponse
} from "../../../../lib/vnext/wallet-discovery";

export const dynamic = "force-dynamic";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const MAX_RESPONSE_CHARACTERS = 2_000_000;
const TIMEOUT_MS = 6_000;
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const requestedWallet = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!isAddress(requestedWallet, { strict: false })) {
    return Response.json({ error: "Enter a valid wallet address." }, { status: 400, headers: noStore });
  }
  const wallet = getAddress(requestedWallet);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BLOCKSCOUT}/api/v2/addresses/${wallet}/token-balances`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Wallet index is unavailable.");
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_CHARACTERS) throw new Error("Wallet index response exceeded the safe limit.");
    const decoded = JSON.parse(raw) as unknown;
    const assets = parseBlockscoutWalletAssets(decoded, MAX_WALLET_DISCOVERY_ASSETS);
    const payload: VNextWalletDiscoveryResponse = {
      chainId: 4_663,
      wallet,
      assets,
      complete: assets.length < MAX_WALLET_DISCOVERY_ASSETS,
      source: "robinhood-chain-blockscout",
      observedAt: new Date().toISOString()
    };
    return Response.json(payload, { headers: noStore });
  } catch {
    return Response.json({
      chainId: 4_663,
      wallet,
      assets: [],
      complete: false,
      source: "robinhood-chain-blockscout",
      observedAt: new Date().toISOString(),
      error: "Wallet discovery is temporarily delayed. Canonical and directory balances can still be checked."
    } satisfies VNextWalletDiscoveryResponse, { status: 503, headers: noStore });
  } finally {
    clearTimeout(timeout);
  }
}
