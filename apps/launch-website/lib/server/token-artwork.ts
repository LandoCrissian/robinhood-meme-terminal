import { getStore } from "@netlify/blobs";
import { verifyMessage, type Address, type Hex } from "viem";
import { artworkCID, artworkLimit, artworkOrigin, artworkProof, assetCID, assetPath, boundedBytes, cidPattern, inspectArtwork, pixelLimit } from "../token-artwork";
import { rmtCreationOwner } from "../owner-creation";

export type ArtworkStore = Pick<ReturnType<typeof getStore>, "get" | "set">;
export const artworkReviewStore = "rmt-token-artwork-review-v1";
export function configuredArtworkStore(review = false) {
  // Preview deployments may only read from the separate validation namespace.
  return getStore({ name: review ? artworkReviewStore : "rmt-token-artwork-v1", consistency: "strong" });
}
function failure(status: number, error: string) {
  return Response.json({error}, {status, headers: {"Cache-Control":"private, no-store"}});
}
async function verified(store: ArtworkStore, cid: string) {
  const data = await store.get("objects/" + cid, {type:"arrayBuffer"});
  if (data === null) return null;
  const bytes = new Uint8Array(data);
  if (artworkCID(bytes) !== cid) throw new Error("Stored content integrity check failed.");
  return bytes;
}
export async function readArtwork(store: ArtworkStore, cid: string, file: string) {
  if (!cidPattern.test(cid) || !["metadata.json","logo.webp","image.webp"].includes(file)) return failure(404,"Missing artwork.");
  try {
    const data = await verified(store,cid);
    if (!data) return failure(404,"Missing artwork.");
    let bytes = data;
    if (file !== "image.webp") {
      if (bytes.length > 512) return failure(404,"Missing metadata.");
      const image = assetCID(JSON.parse(new TextDecoder().decode(bytes)).image, "image.webp");
      if (!image) return failure(404,"Invalid metadata.");
      if (file === "logo.webp") return readArtwork(store,image,"image.webp");
    } else { inspectArtwork(bytes,"image/webp"); }
    return new Response(bytes, {headers: {"Content-Type":file === "metadata.json" ? "application/json" : "image/webp",
      "X-Content-Type-Options":"nosniff", "Cache-Control":"public, max-age=31536000, immutable", ETag:'"' + artworkCID(bytes) + '"'}});
  } catch { return failure(503,"Artwork temporarily unavailable."); }
}
async function reserve(store: ArtworkStore, owner: string, input: string, now: number) {
  const prefix = "uploads/" + owner.toLowerCase() + "/" + new Date(now).toISOString().slice(0,10) + "/";
  for (let i = 0; i < 8; i++) {
    const key = prefix + i;
    const { modified } = await store.set(key,input,{onlyIfNew:true});
    if (modified || await store.get(key,{type:"text"}) === input) return true;
  }
  return false;
}
type Policy = { origin: string; owner: Address; store: () => ArtworkStore };
export async function acceptArtwork(request: Request, policy: Policy) {
  const url = new URL(request.url), h = request.headers;
  if (url.href !== policy.origin + "/api/artwork/upload" || h.get("origin") !== policy.origin || h.get("host") !== url.host ||
      h.has("forwarded") || (h.has("x-forwarded-host") && h.get("x-forwarded-host") !== url.host) ||
      (h.has("x-forwarded-proto") && h.get("x-forwarded-proto") !== url.protocol.slice(0,-1))) return failure(403,"Upload origin unavailable.");
  const mime = h.get("content-type") ?? "", timestamp = Number(h.get("x-artwork-issued")), signature = h.get("x-artwork-proof");
  const input = h.get("x-artwork-cid") ?? "", now = Date.now();
  if (!signature || !/^0x[0-9a-f]{130}$/i.test(signature) || !cidPattern.test(input) || !Number.isSafeInteger(timestamp) ||
      timestamp > now + 5000 || now >= timestamp + 300_000 ||
      !await verifyMessage({address:policy.owner, message:artworkProof(policy.origin,policy.owner,input,timestamp),signature:signature as Hex}).catch(()=>false))
    return failure(401,"Authorize this image with the eligible creator wallet.");
  if (Number(h.get("content-length")) > artworkLimit) return failure(413,"Choose an image up to 2 MiB.");
  let normalized: Buffer;
  try {
    const bytes = await boundedBytes(request.body);
    if (artworkCID(bytes) !== input) return failure(400,"The selected file changed.");
    inspectArtwork(bytes,mime);
    const {default:sharp} = await import("sharp");
    const image = sharp(bytes,{failOn:"warning",limitInputPixels:pixelLimit});
    const meta = await image.metadata();
    if ("image/" + meta.format !== mime || (meta.pages ?? 1) !== 1) throw new Error();
    normalized = await image.rotate().resize({width:1024,height:1024,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
    inspectArtwork(normalized,"image/webp");
  } catch { return failure(422,"Choose a valid still PNG, JPEG or WebP up to 2 MiB and 16 megapixels."); }
  try {
    const store = policy.store(), image = artworkCID(normalized), artworkURL = artworkOrigin + assetPath(image,"image.webp");
    const metadata = new TextEncoder().encode(JSON.stringify({image:artworkURL})), cid = artworkCID(metadata);
    if (!await reserve(store,policy.owner,input,now)) return failure(429,"Daily artwork limit reached. Retry tomorrow.");
    await store.set("objects/" + image,new Uint8Array(normalized).buffer,{onlyIfNew:true});
    await store.set("objects/" + cid,metadata.buffer,{onlyIfNew:true});
    if (!await verified(store,image) || !await verified(store,cid)) throw new Error();
    return Response.json({projectURI:artworkOrigin + assetPath(cid,"metadata.json"),artworkURL},{headers:{"Cache-Control":"private, no-store"}});
  } catch { return failure(503,"Storage could not confirm this upload. Retry with the same image."); }
}
export function uploadArtwork(request: Request) {
  if ((process.env.CONTEXT && process.env.CONTEXT !== "production") || request.headers.get("x-forwarded-proto") !== "https" || process.env.RMT_TOKEN_ARTWORK !== "owner-upload-v1") return failure(404,"Artwork uploads are paused.");
  return acceptArtwork(request,{origin:artworkOrigin, owner:rmtCreationOwner,store:configuredArtworkStore});
}
