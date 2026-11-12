import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createLaunchpadPreviewGateway, localPreviewBackend, previewListenHost } from "../lib/server/launchpad-preview-gateway";
import { readLaunchpadPreviewAccess } from "../lib/server/launchpad-preview-access";
import { readLaunchpadRuntime, verifiedLaunchpadRpc } from "../lib/server/new-launchpad-config";

async function main() {
  const access = readLaunchpadPreviewAccess();
  const runtime = readLaunchpadRuntime();
  if (!access || !runtime) throw new Error("Explicit isolated preview configuration is required.");
  const web = localPreviewBackend(process.env.RMT_LAUNCHPAD_PREVIEW_WEB_URL ?? "http://127.0.0.1:3197");
  const cert = process.env.RMT_LAUNCHPAD_PREVIEW_TLS_CERT;
  const key = process.env.RMT_LAUNCHPAD_PREVIEW_TLS_KEY;
  if (Boolean(cert) !== Boolean(key)) throw new Error("Provide both preview TLS certificate and key.");
  const host = previewListenHost(process.env.RMT_LAUNCHPAD_PREVIEW_BIND ?? "127.0.0.1", !!cert);
  const port = Number(process.env.RMT_LAUNCHPAD_PREVIEW_PORT ?? "3198");
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535 || port === Number(web.port)
    || port === Number(new URL(runtime.privateRpcUrl).port)) throw new Error("Set a distinct preview listener port.");
  if (cert && (access.origin.hostname !== host || Number(access.origin.port || "443") !== port)) {
    throw new Error("The direct TLS address must match the configured preview origin.");
  }

  const rpc = await verifiedLaunchpadRpc(runtime);
  const accounts: unknown = await rpc.request({ method: "eth_accounts" } as never);
  if (!Array.isArray(accounts) || accounts.length !== 0) throw new Error("Restart the isolated fork with zero unlocked accounts before opening a preview.");

  const handler = createLaunchpadPreviewGateway(access, runtime, web);
  const options = { requestTimeout: 12_000, headersTimeout: 8_000, maxHeaderSize: 8_192 };
  const server = cert && key
    ? createHttpsServer({ ...options, cert: readFileSync(cert), key: readFileSync(key), minVersion: "TLSv1.2" }, handler)
    : createHttpServer(options, handler);
  server.maxConnections = 24;
  server.setTimeout(15_000, (socket) => socket.destroy());
  server.on("error", (error) => { console.error("Preview gateway failed:", error.name); process.exitCode = 1; });
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  const expiry = setTimeout(close, access.expiresAt - Date.now());
  expiry.unref();
  server.listen(port, host, () => console.log(`Private preview gateway listening on ${host}:${port} for ${access.origin.origin}.`));
}

void main().catch((error: unknown) => {
  console.error("Preview gateway unavailable:", error instanceof Error ? error.message : "unknown failure");
  process.exitCode = 1;
});
