import { createHash, randomUUID } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  LIVE_POSITION_GUARD_SCHEMA_VERSION,
  livePositionGuardAuthorityMatchesPlan,
  livePositionGuardCancellationDisposition,
  livePositionGuardCanReplaceOrder,
  livePositionGuardHeartbeatIsFresh,
  normalizeLivePositionGuardSettings,
  unitQuoteX18
} from "../../../../lib/live-position-guard";
import { guardMediaRequest, readBoundedJsonRequest } from "../../../../lib/server/media-request-guard";
import { getRmtAdminFirestore } from "../../../../lib/server/firebase-admin";
import {
  delegatedEmbeddedEthereumWallet,
  livePositionGuardServerConfiguration
} from "../../../../lib/server/live-position-guard-execution";
import { privyBearerToken, verifyPrivyIdentity } from "../../../../lib/server/privy-identity";
import { quoteAndBuildExternalUniswapSwap } from "../../../../lib/server/external-uniswap-trade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_UINT128 = (1n << 128n) - 1n;

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

function orderDocumentId(identityId: string, wallet: Address, token: Address) {
  return `guard_${createHash("sha256")
    .update(`${identityId}:${wallet.toLowerCase()}:${token.toLowerCase()}`)
    .digest("hex")}`;
}

function ownerKey(identityId: string) {
  return createHash("sha256").update(identityId).digest("hex");
}

function safeRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function evaluatorIsHealthy(database: NonNullable<ReturnType<typeof getRmtAdminFirestore>>) {
  const heartbeat = await database.collection("livePositionGuardSystem")
    .doc("evaluatorHeartbeat")
    .get();
  const lastSeenAt = heartbeat.data()?.lastSeenAt;
  return livePositionGuardHeartbeatIsFresh(lastSeenAt);
}

function validAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function validAmount(value: unknown) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,38}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n && amount <= MAX_UINT128 ? amount : null;
}

async function verifiedIdentity(request: Request) {
  const token = privyBearerToken(request);
  if (!token) return null;
  const identity = await verifyPrivyIdentity(token);
  return identity.is_guest ? null : identity;
}

function publicOrder(data: Record<string, unknown> | undefined) {
  if (!data) return {
    status: "inactive",
    armedAt: null,
    expiresAt: null,
    lastEvaluatedAt: null,
    revocationPending: false,
    revocationRequestedAt: null,
    transactionHash: null,
    walletCleanupReported: null
  };
  const status = typeof data.status === "string" ? data.status : "inactive";
  const revocationRequestedAt = typeof data.revocationRequestedAt === "number"
    ? data.revocationRequestedAt
    : null;
  return {
    status,
    armedAt: typeof data.armedAt === "number" ? data.armedAt : null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
    lastEvaluatedAt: typeof data.lastEvaluatedAt === "number" ? data.lastEvaluatedAt : null,
    revocationPending: revocationRequestedAt !== null && (status === "executing" || status === "submitted"),
    revocationRequestedAt,
    transactionHash: typeof data.transactionHash === "string" ? data.transactionHash : null,
    walletCleanupReported: revocationRequestedAt === null
      ? null
      : typeof data.walletCleanupReportedAt === "number"
  };
}

export async function GET(request: Request) {
  try {
    const configuration = livePositionGuardServerConfiguration();
    const database = getRmtAdminFirestore();
    const identity = await verifiedIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to manage live Position Guard." }, { status: 401, headers: HEADERS });
    }
    if (!database) {
      return NextResponse.json({
        available: false,
        systemStatus: "release_locked",
        ...publicOrder(undefined)
      }, { headers: HEADERS });
    }
    const url = new URL(request.url);
    const wallet = validAddress(url.searchParams.get("wallet"));
    const token = validAddress(url.searchParams.get("token"));
    if (!wallet || !token) {
      return NextResponse.json({ error: "Choose a valid wallet and token." }, { status: 400, headers: HEADERS });
    }
    const document = await database.collection("livePositionGuardOrders")
      .doc(orderDocumentId(identity.id, wallet, token))
      .get();
    const data = document.data() as Record<string, unknown> | undefined;
    if (data && data.ownerKey !== ownerKey(identity.id)) {
      return NextResponse.json({ error: "Position Guard ownership could not be verified." }, { status: 403, headers: HEADERS });
    }
    if (!configuration) {
      return NextResponse.json({
        available: false,
        systemStatus: "release_locked",
        ...publicOrder(data)
      }, { headers: HEADERS });
    }
    if (!await evaluatorIsHealthy(database)) {
      return NextResponse.json({
        available: false,
        systemStatus: "worker_offline",
        ...publicOrder(data)
      }, { headers: HEADERS });
    }
    return NextResponse.json({
      available: true,
      systemStatus: "ready",
      ...publicOrder(data)
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "RMT could not verify live Position Guard." }, { status: 401, headers: HEADERS });
  }
}

export async function POST(request: Request) {
  const requestGuard = guardMediaRequest(request, { namespace: "live-position-guard", limit: 8, windowMs: 60_000 });
  if (!requestGuard.ok) {
    return NextResponse.json({ error: requestGuard.error }, {
      status: requestGuard.status,
      headers: {
        ...HEADERS,
        ...(requestGuard.retryAfterSeconds ? { "Retry-After": String(requestGuard.retryAfterSeconds) } : {})
      }
    });
  }
  const parsed = await readBoundedJsonRequest(request, 4_096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: HEADERS });
  const input = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : {};
  const action = input.action;
  const wallet = validAddress(input.wallet);
  const token = validAddress(input.token);
  if ((action !== "arm" && action !== "cancel") || !wallet || !token) {
    return NextResponse.json({ error: "Choose a valid Position Guard action, wallet and token." }, {
      status: 400,
      headers: HEADERS
    });
  }

  try {
    const database = getRmtAdminFirestore();
    const identity = await verifiedIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to manage live Position Guard." }, { status: 401, headers: HEADERS });
    }
    if (!database) {
      return NextResponse.json({ error: "Live Position Guard records are temporarily unavailable." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "30" }
      });
    }
    const identityOwnerKey = ownerKey(identity.id);
    const reference = database.collection("livePositionGuardOrders")
      .doc(orderDocumentId(identity.id, wallet, token));

    if (action === "cancel") {
      const existing = await reference.get();
      if (!existing.exists) {
        return NextResponse.json({ available: true, ...publicOrder(undefined) }, { headers: HEADERS });
      }
      const existingData = existing.data() as Record<string, unknown>;
      if (existingData.ownerKey !== identityOwnerKey) {
        return NextResponse.json({ error: "Position Guard ownership could not be verified." }, {
          status: 403,
          headers: HEADERS
        });
      }
      const now = Date.now();
      const walletCleanupReportedAt = input.walletAuthorityRemoved === true ? now : null;
      const disposition = livePositionGuardCancellationDisposition(existingData.status);
      if (disposition === "reconcile") {
        const next = { ...existingData, revocationRequestedAt: now, walletCleanupReportedAt };
        await reference.set({
          revocationRequestedAt: now,
          updatedAt: FieldValue.serverTimestamp(),
          walletCleanupReportedAt
        }, { merge: true });
        return NextResponse.json({ available: true, ...publicOrder(next) }, { headers: HEADERS });
      }
      if (disposition === "review") {
        const next = {
          ...existingData,
          reviewReason: "cancellation_unknown_state",
          revocationRequestedAt: now,
          status: "review_required",
          walletCleanupReportedAt
        };
        await reference.set({
          reviewReason: "cancellation_unknown_state",
          revocationRequestedAt: now,
          status: "review_required",
          updatedAt: FieldValue.serverTimestamp(),
          walletCleanupReportedAt
        }, { merge: true });
        return NextResponse.json({ available: true, ...publicOrder(next) }, { headers: HEADERS });
      }
      const next = {
        ...existingData,
        cancelledAt: now,
        revocationRequestedAt: now,
        status: "cancelled",
        walletCleanupReportedAt
      };
      await reference.set({
        cancelledAt: now,
        revocationRequestedAt: now,
        status: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
        walletCleanupReportedAt
      }, { merge: true });
      return NextResponse.json({ available: true, ...publicOrder(next) }, { headers: HEADERS });
    }

    const configuration = livePositionGuardServerConfiguration();
    if (!configuration) {
      return NextResponse.json({ error: "Live Position Guard is release-locked." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "3600" }
      });
    }
    if (!await evaluatorIsHealthy(database)) {
      return NextResponse.json({ error: "Live Position Guard is temporarily unavailable because its evaluator is offline." }, {
        status: 503,
        headers: { ...HEADERS, "Retry-After": "30" }
      });
    }

    const pair = validAddress(input.pair);
    const amountIn = validAmount(input.amountIn);
    const settings = normalizeLivePositionGuardSettings(input.settings);
    if (!pair || !amountIn || !settings) {
      return NextResponse.json({ error: "Position Guard limits are incomplete or outside safe bounds." }, {
        status: 400,
        headers: HEADERS
      });
    }
    const latestUser = await new PrivyClient({
      appId: configuration.appId,
      appSecret: configuration.appSecret
    }).users()._get(identity.id);
    const embeddedWallet = delegatedEmbeddedEthereumWallet(latestUser, wallet);
    if (!embeddedWallet?.id) {
      return NextResponse.json({
        error: "Use the RMT embedded wallet and approve the bounded Position Guard permission first."
      }, { status: 409, headers: HEADERS });
    }

    const [executorCode, allowance, balance, quote] = await Promise.all([
      client.getBytecode({ address: configuration.executor }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, configuration.executor]
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet]
      }),
      quoteAndBuildExternalUniswapSwap({
        token,
        pair,
        recipient: wallet,
        side: "sell",
        amountIn,
        maxPriceImpact: settings.maxPriceImpactBps / 10_000
      })
    ]);
    if (!executorCode) {
      return NextResponse.json({ error: "The Position Guard execution boundary is not deployed on Robinhood Chain." }, {
        status: 503,
        headers: HEADERS
      });
    }
    if (!livePositionGuardAuthorityMatchesPlan({ allowance, balance, amountIn })) {
      return NextResponse.json({
        error: "Position Guard requires an exact executor allowance equal to the protected amount, and the wallet must still hold that amount."
      }, { status: 409, headers: HEADERS });
    }
    if (quote.executionFee || !quote.grossQuoteOut || !quote.grossMinimumOut) {
      return NextResponse.json({ error: "This route is not eligible for zero-fee automatic protection." }, {
        status: 409,
        headers: HEADERS
      });
    }

    const now = Date.now();
    const expiresAt = now + settings.expiresAfterHours * 60 * 60 * 1_000;
    const entryUnitQuote = unitQuoteX18(BigInt(quote.grossQuoteOut), amountIn);
    const authorizationId = randomUUID();
    await database.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      const existingData = existing.data() as Record<string, unknown> | undefined;
      if (existingData && existingData.ownerKey !== identityOwnerKey) {
        throw new Error("Position Guard ownership could not be verified.");
      }
      if (existingData && !livePositionGuardCanReplaceOrder(
        existingData.status,
        existingData.walletCleanupReportedAt
      )) {
        throw new Error("Position Guard must be cleared or reconciled before another automatic order can be armed.");
      }
      const revision = safeRevision(existingData?.revision) + 1;
      transaction.set(reference, {
        amountIn: amountIn.toString(),
        armedAt: now,
        authorizationId,
        chainId: 4663,
        createdAt: FieldValue.serverTimestamp(),
        entryUnitQuoteX18: entryUnitQuote.toString(),
        executor: configuration.executor,
        expiresAt,
        firstBelowFloorAt: null,
        firstBelowFloorBlock: null,
        highWatermarkUnitQuoteX18: entryUnitQuote.toString(),
        lastEvaluatedAt: null,
        ownerKey: identityOwnerKey,
        pair,
        revision,
        schemaVersion: LIVE_POSITION_GUARD_SCHEMA_VERSION,
        settings,
        status: "active",
        token,
        updatedAt: FieldValue.serverTimestamp(),
        wallet,
        walletId: embeddedWallet.id
      }, { merge: false });
    });
    return NextResponse.json({
      available: true,
      armedAt: now,
      expiresAt,
      revocationPending: false,
      revocationRequestedAt: null,
      status: "active",
      systemStatus: "ready",
      walletCleanupReported: null
    }, { headers: HEADERS });
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error && /^(Live Position Guard|Position Guard|Use the RMT|Confirm the exact|This route|The Position Guard)/.test(cause.message)
        ? cause.message
        : "RMT could not safely update live Position Guard."
    }, { status: 409, headers: HEADERS });
  }
}
