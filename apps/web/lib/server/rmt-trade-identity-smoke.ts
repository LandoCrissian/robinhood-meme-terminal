import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  requireAuthenticatedTradeWallet,
  TradeIdentityError
} from "./rmt-trade-identity";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const otherWallet = getAddress("0x2222222222222222222222222222222222222222");

function request(token = "identity-token") {
  return new Request("https://rmtlaunch.fun/api/trade", {
    method: "POST",
    headers: token ? { "privy-id-token": token } : {}
  });
}

function identity(address: string = wallet, guest = false) {
  return {
    id: "did:privy:rmt-trader",
    is_guest: guest,
    linked_accounts: [{
      type: "wallet" as const,
      address,
      chain_type: "ethereum" as const,
      verified_at: 100,
      first_verified_at: 100,
      latest_verified_at: 100,
      wallet_client: "unknown" as const
    }]
  };
}

function identityWithMultipleWallets() {
  return {
    ...identity(wallet),
    linked_accounts: [
      ...identity(wallet).linked_accounts,
      ...identity(otherWallet).linked_accounts
    ]
  };
}

async function expectIdentityError(action: () => Promise<unknown>, status: number, message: RegExp) {
  await assert.rejects(action, (cause: unknown) => (
    cause instanceof TradeIdentityError
    && cause.status === status
    && message.test(cause.message)
  ));
}

async function run() {
  await expectIdentityError(
    () => requireAuthenticatedTradeWallet(request(""), wallet, async () => identity()),
    401,
    /Sign in to RMT/
  );
  await expectIdentityError(
    () => requireAuthenticatedTradeWallet(request(), wallet, async () => identity(wallet, true)),
    403,
    /Finish RMT account sign-in/
  );
  await expectIdentityError(
    () => requireAuthenticatedTradeWallet(request(), wallet, async () => identity(otherWallet)),
    403,
    /Link and select this wallet/
  );
  await expectIdentityError(
    () => requireAuthenticatedTradeWallet(request(), wallet, async () => { throw new Error("expired"); }),
    401,
    /sign-in expired/
  );
  await expectIdentityError(
    () => requireAuthenticatedTradeWallet(request(), wallet, async () => { throw new Error("privy_identity_not_configured"); }),
    503,
    /secure identity configuration/
  );

  const authorization = await requireAuthenticatedTradeWallet(
    request(),
    wallet,
    async () => identity(wallet.toLowerCase())
  );
  assert.deepEqual(authorization, { status: "identity-wallet-bound", wallet, identityId: "did:privy:rmt-trader" });

  const secondLinkedWallet = await requireAuthenticatedTradeWallet(
    request(),
    otherWallet,
    async () => identityWithMultipleWallets()
  );
  assert.deepEqual(secondLinkedWallet, { status: "identity-wallet-bound", wallet: otherWallet, identityId: "did:privy:rmt-trader" });
}

void run().then(() => console.log("protected trade identity smoke passed"));
