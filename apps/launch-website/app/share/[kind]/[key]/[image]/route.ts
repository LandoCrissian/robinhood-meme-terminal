import { createHash } from "node:crypto";
import { creatorCard, tokenCard } from "../../../../../lib/social";
import { readCreator, publicAvatar, readShareToken, shareImagePath } from "../../../../../lib/server/social-pages";
import { renderShareImage } from "../../../../../lib/server/social-image";
import { assetCID } from "../../../../../lib/token-artwork";
import { configuredArtworkStore, readArtwork } from "../../../../../lib/server/token-artwork";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Params = { params: Promise<{kind:string; key:string; image:string}> };
const failure = (status: number) => new Response(null, {status, headers:{"Cache-Control":"no-store"}});

async function cardResponse(request: Request, {params}: Params) {
  const {kind,key,image} = await params;
  if (!/^[0-9a-f]{24}\.png$/.test(image) || new URL(request.url).search ||
    !(kind === "u" ? /^[a-z][a-z0-9_]{2,23}$/.test(key) : ["creator","launches"].includes(kind) && /^0x[0-9a-f]{40}$/.test(key))) return failure(404);
  try {
    let card, portrait: Buffer | null = null;
    const path = "/share/" + kind + "/" + key + "/" + image;
    if (kind === "launches") {
      const token = await readShareToken(key);
      if (!token) return failure(404);
      card = tokenCard(token);
      if (shareImagePath(card) !== path) return failure(404);
      const cid = assetCID(token.projectURI, "metadata.json");
      if (cid) {
        const artwork = await readArtwork(configuredArtworkStore(),cid,"logo.webp");
        if (artwork.ok) portrait = Buffer.from(await artwork.arrayBuffer());
      }
    } else {
      const found = await readCreator(kind === "u" ? "u" : "creator", key);
      if (found.status !== "ready") return failure(found.status === "missing" ? 404 : 503);
      card = creatorCard(found.profile);
      if (shareImagePath(card) !== path) return failure(404);
      portrait = await publicAvatar(found.profile);
    }
    const png = await renderShareImage(card, portrait);
    const etag = '"' + createHash("sha256").update(png).digest("hex") + '"';
    const headers = { "Content-Type":"image/png", "Cache-Control":"public, max-age=60, s-maxage=60, must-revalidate",
      "Content-Length":String(png.byteLength), "X-Content-Type-Options":"nosniff", ETag:etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null,{status:304,headers});
    return new Response(request.method === "HEAD" ? null : new Uint8Array(png),{headers});
  } catch { return failure(503); }
}

export { cardResponse as GET, cardResponse as HEAD };

