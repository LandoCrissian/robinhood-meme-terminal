import { request as forwardHttp, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http";
import { BlockList, isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { createPublicClient, http, toHex, type Address } from "viem";
import { samePreviewCapability, type LaunchpadPreviewAccess } from "./launchpad-preview-access";
import { permittedPreviewRpc, previewRpcMaxGas, type PreviewRpcPolicy } from "./launchpad-preview-rpc";
import type { LaunchpadRuntime } from "./new-launchpad-config";
import { LaunchpadStore } from "./new-launchpad-store";

const cookieName = "__Host-rmt-launch-preview";
const accessPath = "/preview-access";
const maxRequestBytes = 16_384;
const maxRpcResponseBytes = 384 * 1_024;
const safePages = new Set(["/", "/create-token", "/my-launches", "/wallet", "/rmt", "/terms", "/privacy", "/risks", "/support", "/manifest.webmanifest"]);
const ignoredProxyHeaders = new Set(["host", "cookie", "authorization", "origin", "sec-fetch-site", "forwarded",
  "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "content-length"]);

class PreviewInputError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function localPreviewBackend(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || !url.port
    || url.username || url.password || url.search || url.hash) throw new Error("The preview web backend must be a separate loopback port.");
  return url;
}

export function previewListenHost(value: string, tls: boolean) {
  if (value !== "127.0.0.1" && (!tls || privateNetworkPrefix(value) === undefined)) {
    throw new Error("Only loopback or a TLS-protected private LAN address can listen.");
  }
  return value;
}

function privateNetworkPrefix(address: string) {
  if (!isIPv4(address)) return;
  const [first, second] = address.split(".").map(Number);
  if (first === 10) return 8;
  if (first === 172 && second >= 16 && second <= 31) return 12;
  if (first === 192 && second === 168) return 16;
}

export function previewLanAccess(bind: string, peer: string | undefined, interfaces = networkInterfaces()) {
  if (bind === "127.0.0.1") {
    if (peer) throw new Error("Set a LAN peer only for direct private TLS.");
    return null;
  }
  const minimum = privateNetworkPrefix(bind);
  const attached = Object.values(interfaces).flat().find((entry) =>
    entry && entry.family === "IPv4" && !entry.internal && entry.address === bind);
  const prefix = Number(attached?.cidr?.split("/")[1]);
  if (minimum === undefined || !Number.isInteger(prefix) || prefix < minimum || prefix > 32) {
    throw new Error("Bind the private TLS preview to a locally attached IPv4 subnet.");
  }
  const peers = new BlockList();
  peers.addSubnet(bind, prefix, "ipv4");
  if (peer && (!isIPv4(peer) || !peers.check(peer, "ipv4"))) {
    throw new Error("The preview peer IPv4 address must be on the same LAN subnet.");
  }
  return (address: string | undefined) => address !== undefined && isIPv4(address)
    && (peer ? address === peer : peers.check(address, "ipv4"));
}

function rateBudget(limit: number) {
  let minute = -1;
  let count = 0;
  return (weight = 1) => {
    const currentMinute = Math.floor(Date.now() / 60_000);
    if (currentMinute !== minute) { minute = currentMinute; count = 0; }
    if (count + weight > limit) return false;
    count += weight;
    return true;
  };
}

async function readBody(request: IncomingMessage, limit: number) {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    request.resume();
    throw new PreviewInputError(413, "Request too large.");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  // Keep reading a bounded body without destroying the socket on a rejected request.
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        request.off("data", onData);
        request.resume();
        reject(new PreviewInputError(413, "Request too large."));
      } else chunks.push(chunk);
    };
    request.on("data", onData);
    request.once("end", resolve);
    request.once("error", reject);
  });
  return Buffer.concat(chunks);
}

async function readRpcResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty upstream RPC response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      length += value.length;
      if (length > maxRpcResponseBytes) {
        await reader.cancel();
        throw new Error("Upstream RPC response exceeds preview size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function send(response: ServerResponse, status: number, message: string, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(message);
}

function rpcError(response: ServerResponse, status: number, id: string | number | null, message: string) {
  send(response, status, JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }), "application/json");
}

function authenticated(request: IncomingMessage, access: LaunchpadPreviewAccess) {
  if (samePreviewCapability(request.headers.authorization, `Bearer ${access.accessCode}`)) return true;
  const value = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return samePreviewCapability(value, access.cookieValue);
}

function permittedAsset(pathname: string) {
  if (!pathname.startsWith("/_next/static/") && !pathname.startsWith("/brand/")) return false;
  if (/%2f|%5c/i.test(pathname)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  return /^\/(?:_next\/static|brand)\/[\w.@\-/()[\]]+$/.test(decoded)
    && decoded.split("/").every((part) => part !== "." && part !== "..");
}

function permittedWebRoute(pathname: string, method: string) {
  if (method === "GET" || method === "HEAD") {
    return safePages.has(pathname) || /^\/launches\/0x[\da-f]{40}$/i.test(pathname)
      || permittedAsset(pathname)
      || /^\/api\/launchpad\/(?:config|launches|public\/[a-z_]+)$/.test(pathname)
      || pathname === "/mcp";
  }
  return method === "POST" && (pathname === "/api/launchpad/launches" || pathname === "/mcp");
}

function proxyWeb(request: IncomingMessage, response: ServerResponse, backend: URL, pathname: string, body: Buffer) {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && !ignoredProxyHeaders.has(name) && !name.startsWith("x-forwarded-")
      && !name.startsWith("tailscale-")) headers[name] = value;
  }
  if (body.length) headers["content-length"] = String(body.length);
  const upstream = forwardHttp(new URL(pathname, backend), { method: request.method, headers, timeout: 20_000 }, (incoming) => {
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined || ignoredProxyHeaders.has(name) || name === "set-cookie" || name === "cache-control"
        || name === "x-robots-tag" || name === "referrer-policy") continue;
      response.setHeader(name, value);
    }
    response.writeHead(incoming.statusCode ?? 502);
    incoming.pipe(response);
    incoming.on("error", () => response.destroy());
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) send(response, 502, "Preview app unavailable.");
    else response.destroy();
  });
  response.on("close", () => upstream.destroy());
  upstream.end(body);
}

const unlockForm = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RMT Launch preview</title><main><h1>RMT Launch preview</h1><p>Private test network. Use a separate test wallet.</p><form method="post"><label>Preview access code <input name="code" type="password" autocomplete="off" required></label> <button>Open preview</button></form></main></html>';

export function createLaunchpadPreviewGateway(
  access: LaunchpadPreviewAccess,
  config: LaunchpadRuntime,
  backend: URL,
  upstreamFetch: typeof fetch = fetch,
): RequestListener {
  if (config.deployment.chainId !== 31337 || config.deployment.rpcUrl !== new URL(access.rpcPath, access.origin).href
    || backend.origin === new URL(config.privateRpcUrl).origin) {
    throw new Error("Preview gateway bindings disagree with the local launchpad runtime.");
  }
  const client = createPublicClient({ transport: http(config.privateRpcUrl, { retryCount: 0, timeout: 5_000 }) });
  const policy: PreviewRpcPolicy = {
    runtime: config, wallet: access.wallet, readTransaction: (hash) => client.getTransaction({ hash }),
    readLaunch: (token: Address) => {
      const store = new LaunchpadStore(config.databasePath, config.scope);
      try { return store.read({ token })[0]; } finally { store.close(); }
    },
  };
  const allowRequest = rateBudget(600);
  const allowUnlock = rateBudget(12);
  const allowRpc = rateBudget(360);
  const allowBroadcast = rateBudget(24);
  const allowTrace = rateBudget(20);

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    if (Date.now() >= access.expiresAt) return send(response, 410, "This preview has expired.");
    if (!request.url || !request.url.startsWith("/") || request.url.length > 2_048 || request.headers.host !== access.origin.host) {
      return send(response, 421, "Invalid preview origin.");
    }
    const url = new URL(request.url, access.origin);
    if (url.origin !== access.origin.origin) return send(response, 421, "Invalid preview origin.");
    if (request.headers["tailscale-funnel-request"] !== undefined) {
      return send(response, 403, "Public ingress is outside this preview.");
    }
    if (request.headers.origin !== undefined && request.headers.origin !== access.origin.origin) {
      return send(response, 403, "Origin is not authorized.");
    }
    if (!allowRequest()) return send(response, 429, "Preview request limit reached.");

    if (url.pathname === accessPath && request.method === "GET") {
      response.setHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
      return send(response, 200, unlockForm, "text/html; charset=utf-8");
    }
    if (url.pathname === accessPath && request.method === "POST") {
      if (request.headers.origin !== access.origin.origin) return send(response, 403, "Submit the code from the preview page.");
      if (!allowUnlock()) return send(response, 429, "Preview access limit reached.");
      if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) return send(response, 415, "Invalid preview form.");
      const code = new URLSearchParams((await readBody(request, 512)).toString("utf8")).get("code");
      if (!samePreviewCapability(code ?? undefined, access.accessCode)) return send(response, 403, "Preview code was not accepted.");
      const maxAge = Math.floor((access.expiresAt - Date.now()) / 1_000);
      response.writeHead(303, { Location: "/", "Set-Cookie": `${cookieName}=${access.cookieValue}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` });
      return response.end();
    }
    if (url.pathname.startsWith("/preview-rpc/")) {
      if (!samePreviewCapability(url.pathname, access.rpcPath) || url.search) return send(response, 404, "Preview route not found.");
      if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) {
        return rpcError(response, 405, null, "Use JSON-RPC POST.");
      }
      if (!allowRpc()) return rpcError(response, 429, null, "Preview RPC rate limit reached.");
      let call: unknown;
      try { call = JSON.parse((await readBody(request, maxRequestBytes)).toString("utf8")); }
      catch (error) {
        if (error instanceof PreviewInputError) throw error;
        return rpcError(response, 400, null, "Invalid JSON-RPC request.");
      }
      if (!call || typeof call !== "object" || Array.isArray(call)) return rpcError(response, 400, null, "Send a single JSON-RPC request.");
      const { id, jsonrpc, method, params = [] } = call as Record<string, unknown>;
      if (!(typeof id === "string" && id.length <= 80 || typeof id === "number" && Number.isSafeInteger(id))
        || jsonrpc !== "2.0" || typeof method !== "string" || !Array.isArray(params)) {
        return rpcError(response, 400, null, "Invalid JSON-RPC request.");
      }
      if ((method === "eth_sendRawTransaction" && !allowBroadcast()) || (method === "debug_traceTransaction" && !allowTrace())) {
        return rpcError(response, 429, id, "Preview operation rate limit reached.");
      }
      if (!await permittedPreviewRpc(policy, method, params)) return rpcError(response, 403, id, "RPC operation is outside this preview.");
      const boundedParams = method === "eth_call" || method === "eth_estimateGas"
        ? [{ gas: toHex(previewRpcMaxGas), ...params[0] as object }, ...params.slice(1)] : params;
      try {
        const upstream = await upstreamFetch(config.privateRpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc, id, method, params: boundedParams }),
          signal: AbortSignal.timeout(8_000), redirect: "error",
        });
        if (!upstream.ok) throw new Error("RPC unavailable");
        const result = JSON.parse(await readRpcResponse(upstream));
        if ("error" in result) return rpcError(response, 200, id, "Test-chain RPC rejected the request.");
        if (!("result" in result)) throw new Error("Invalid RPC response");
        return send(response, 200, JSON.stringify({ jsonrpc, id, result: result.result }), "application/json");
      } catch { return rpcError(response, 502, id, "Test-chain RPC unavailable."); }
    }
    const method = request.method ?? "";
    if (!permittedWebRoute(url.pathname, method)) return send(response, 404, "Preview route not found.");
    if (!authenticated(request, access)) {
      if (method === "GET" && safePages.has(url.pathname)) {
        response.writeHead(303, { Location: accessPath });
        return response.end();
      }
      return send(response, 401, "Preview access required.");
    }
    const body = method === "POST" ? await readBody(request, maxRequestBytes) : Buffer.alloc(0);
    proxyWeb(request, response, backend, url.pathname + url.search, body);
  }

  return (request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) return response.destroy();
      if (error instanceof PreviewInputError) return send(response, error.status, error.message);
      return send(response, 502, "Preview request failed.");
    });
  };
}
