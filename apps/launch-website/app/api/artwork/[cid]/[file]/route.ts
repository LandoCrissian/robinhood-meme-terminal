import { configuredArtworkStore, readArtwork } from "../../../../../lib/server/token-artwork";
export const dynamic = "force-dynamic";
export async function GET(request: Request, {params}: {params: Promise<{cid:string;file:string}>}) {
  const {cid,file} = await params;
  try { return await readArtwork(configuredArtworkStore(request.headers.get("host") !== "www.rmtlaunch.fun"),cid,file); }
  catch { return new Response(null,{status:503,headers:{"Cache-Control":"no-store"}}); }
}
