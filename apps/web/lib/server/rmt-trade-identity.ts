import type { User as PrivyUser } from "@privy-io/node";
import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { rmtLaunchFactoryV6Abi } from "../contracts";
import { activeChain } from "../network";
import { resolveActiveFactory } from "./launch-feed";
import { verifyPrivyIdentity } from "./privy-identity";

const client = createPublicClient({
  chain: activeChain,
  transport: http(process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? activeChain.rpcUrls.default.http[0], { retryCount: 3, timeout: 12_000 })
});

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

export type TradeWalletAuthorization = {
  status: "identity-wallet-bound";
  wallet: Address;
  identityId: string;
};

export class TradeIdentityError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TradeIdentityError";
    this.status = status;
  }
}

type TradeIdentity = Pick<PrivyUser, "id" | "is_guest" | "linked_accounts">;
type TradeIdentityVerifier = (identityToken: string) => Promise<TradeIdentity>;

function identityToken(request: Request) {
  return request.headers.get("privy-id-token")?.trim() ?? "";
}

function verifiedWalletAddress(identity: TradeIdentity, recipient: Address) {
  return identity.linked_accounts.find((account) => {
    if ((account.type !== "wallet" && account.type !== "smart_wallet") || !isAddress(account.address)) return false;
    if (account.type === "wallet" && account.chain_type !== "ethereum") return false;
    return account.verified_at > 0 && sameAddress(getAddress(account.address), recipient);
  });
}

export async function requireAuthenticatedTradeWallet(
  request: Request,
  recipient: Address,
  verify: TradeIdentityVerifier = verifyPrivyIdentity
): Promise<TradeWalletAuthorization> {
  const token = identityToken(request);
  if (!token) throw new TradeIdentityError("Sign in to RMT before preparing a trade.", 401);

  let identity: TradeIdentity;
  try {
    identity = await verify(token);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "privy_identity_not_configured") {
      throw new TradeIdentityError("Protected trading is awaiting secure identity configuration.", 503);
    }
    throw new TradeIdentityError("Your RMT sign-in expired. Sign in again before trading.", 401);
  }
  if (identity.is_guest) {
    throw new TradeIdentityError("Finish RMT account sign-in before preparing a trade.", 403);
  }
  if (!verifiedWalletAddress(identity, recipient)) {
    throw new TradeIdentityError("Link and select this wallet in your RMT account before trading.", 403);
  }
  return { status: "identity-wallet-bound", wallet: recipient, identityId: identity.id };
}

export function tradeIdentityErrorResponse(cause: unknown) {
  if (!(cause instanceof TradeIdentityError)) return null;
  return Response.json(
    { error: cause.message },
    {
      status: cause.status,
      headers: {
        "Cache-Control": "no-store",
        ...(cause.status === 503 ? { "Retry-After": "60" } : {})
      }
    }
  );
}

export async function verifyActiveV6LaunchIdentity(params: { launchId: bigint; token: Address }) {
  const activeFactory = await resolveActiveFactory();
  if (!activeFactory || activeFactory.version !== 6) throw new Error("The active V6 factory could not be verified.");
  const launch = await client.readContract({ address: activeFactory.address, abi: rmtLaunchFactoryV6Abi, functionName: "getLaunch", args: [params.launchId] });
  if (!sameAddress(launch.token, params.token)) throw new Error("This token is not the requested active V6 launch.");
  return launch;
}
