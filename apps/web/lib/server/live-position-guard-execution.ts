import {
  PrivyClient,
  isEmbeddedWalletLinkedAccount,
  type LinkedAccountEmbeddedWallet,
  type User as PrivyUser
} from "@privy-io/node";
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import {
  livePositionGuardPublicConfiguration,
  rmtPositionGuardExecutorAbi
} from "../live-position-guard";

const SECRET = /^[A-Za-z0-9._~-]{16,512}$/;
const BASE64 = /^[A-Za-z0-9+/]{40,2048}={0,2}$/;

export type LivePositionGuardServerConfiguration = {
  appId: string;
  appSecret: string;
  authorizationPrivateKey: string;
  evaluatorToken: string;
  executor: Address;
  policyId: string;
  signerId: string;
  workerEnabled: true;
};

export function livePositionGuardServerConfiguration(
  env: Record<string, string | undefined> = process.env
): LivePositionGuardServerConfiguration | null {
  const publicConfiguration = livePositionGuardPublicConfiguration(env);
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
  const appSecret = env.PRIVY_APP_SECRET?.trim() ?? "";
  const authorizationPrivateKey = env.RMT_POSITION_GUARD_AUTHORIZATION_PRIVATE_KEY?.trim() ?? "";
  const evaluatorToken = env.RMT_POSITION_GUARD_EVALUATOR_TOKEN?.trim() ?? "";
  const workerEnabled = env.RMT_POSITION_GUARD_WORKER_ENABLED?.trim() === "true";
  if (
    !publicConfiguration?.enabled || appId.length !== 25 || !SECRET.test(appSecret)
    || !BASE64.test(authorizationPrivateKey) || !SECRET.test(evaluatorToken) || !workerEnabled
  ) return null;
  return {
    executor: publicConfiguration.executor,
    policyId: publicConfiguration.policyId,
    signerId: publicConfiguration.signerId,
    appId,
    appSecret,
    authorizationPrivateKey,
    evaluatorToken,
    workerEnabled: true
  };
}

export function embeddedEthereumWallet(
  user: Pick<PrivyUser, "linked_accounts">,
  wallet: Address
): LinkedAccountEmbeddedWallet | null {
  for (const account of user.linked_accounts) {
    if (
      isEmbeddedWalletLinkedAccount(account)
      && account.chain_type === "ethereum"
      && account.id
      && isAddress(account.address)
      && getAddress(account.address).toLowerCase() === wallet.toLowerCase()
    ) return account;
  }
  return null;
}

export function delegatedEmbeddedEthereumWallet(
  user: Pick<PrivyUser, "linked_accounts">,
  wallet: Address
): LinkedAccountEmbeddedWallet | null {
  const account = embeddedEthereumWallet(user, wallet);
  return account?.delegated ? account : null;
}

export function buildLivePositionGuardCheckpointCall(input: {
  executor: Address;
  orderId: Hex;
}) {
  return {
    to: input.executor,
    data: encodeFunctionData({
      abi: rmtPositionGuardExecutorAbi,
      functionName: "checkpointV3Order",
      args: [input.orderId]
    })
  };
}

export function buildLivePositionGuardExecutorCall(input: {
  amountOutMinimum: bigint;
  deadline: bigint;
  executor: Address;
  orderId: Hex;
}) {
  if (input.amountOutMinimum <= 0n || input.deadline <= 0n) {
    throw new Error("Invalid live Position Guard execution request.");
  }
  return {
    to: input.executor,
    data: encodeFunctionData({
      abi: rmtPositionGuardExecutorAbi,
      functionName: "executeV3Exit",
      args: [{
        orderId: input.orderId,
        amountOutMinimum: input.amountOutMinimum,
        deadline: input.deadline
      }]
    })
  };
}

export function buildLivePositionGuardCancelCall(input: {
  executor: Address;
  orderId: Hex;
}) {
  return {
    to: input.executor,
    data: encodeFunctionData({
      abi: rmtPositionGuardExecutorAbi,
      functionName: "cancelV3Order",
      args: [input.orderId]
    })
  };
}

export async function sendLivePositionGuardTransaction(input: {
  call: { data: Hex; to: Address };
  configuration: LivePositionGuardServerConfiguration;
  idempotencyKey: string;
  walletId: string;
}) {
  const client = new PrivyClient({
    appId: input.configuration.appId,
    appSecret: input.configuration.appSecret,
    requestExpiry: { defaultMs: 60_000, defaultIntentMs: 60_000 }
  });
  return client.wallets().ethereum().sendTransaction(input.walletId, {
    caip2: "eip155:4663",
    params: {
      transaction: {
        chain_id: 4663,
        data: input.call.data,
        to: input.call.to,
        value: 0
      }
    },
    authorization_context: {
      authorization_private_keys: [input.configuration.authorizationPrivateKey]
    },
    idempotency_key: input.idempotencyKey,
    request_expiry: Date.now() + 60_000
  });
}
