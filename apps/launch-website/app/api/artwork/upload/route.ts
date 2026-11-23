import { uploadArtwork } from "../../../../lib/server/token-artwork";
export const dynamic = "force-dynamic";
import {publishDescription} from "../../../../lib/server/rmt-metadata";
export function POST(request: Request) {
  return request.headers.get("content-type")?.split(";")[0] === "application/json" ? publishDescription(request) : uploadArtwork(request);
}
