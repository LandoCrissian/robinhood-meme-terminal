import { isAddress, zeroAddress } from "viem";
import { tokenArtwork } from "../../../../lib/server/token-artwork-reader";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const contract = params.get("address") ?? "";
  if (!isAddress(contract, { strict: false }) || contract.toLowerCase() === zeroAddress) return new Response(null, { status: 400 });
  const image = await tokenArtwork(contract, params.get("legacy")).catch(() => null);
  if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.type, "Content-Length": String(image.bytes.length), "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
