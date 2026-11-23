import {createHash} from "node:crypto";
import {assetCID, artworkOrigin, boundedBytes, cidPattern} from "../token-artwork";
import {descriptionMetadata, originalRmtMetadataCID, rmtImageCID} from "../rmt-metadata";
import {rmtCreationOwner} from "../owner-creation";
import {configuredArtworkStore, readArtwork, reserve} from "./token-artwork";
import {requireAuthentication, requireCsrf} from "./profiles/auth";
import {profileConfig, ProfileError, requireProfileRequest} from "./profiles/config";
import {profileFirebase} from "./profiles/firebase";

export function approvedMetadataURI(uri: unknown, operationalHash: string, record = process.env.RMT_OWNER_METADATA_APPROVAL) {
  if (!record || record.length > 512 || createHash("sha256").update(record).digest("hex") !== operationalHash) return false;
  try {
    const {metadataCID,operationsEvidenceSha256}=JSON.parse(record);
    return cidPattern.test(metadataCID) && metadataCID !== originalRmtMetadataCID && /^[0-9a-f]{64}$/.test(operationsEvidenceSha256) &&
      assetCID(uri,"metadata.json") === metadataCID;
  } catch {return false;}
}
export async function publishDescription(request: Request) {
  const fail=(error:string,status:number)=>Response.json({error},{status,headers:{"Cache-Control":"no-store"}});
  try {
    const config=profileConfig();
    if (!config || config.origin!==artworkOrigin || request.url!==artworkOrigin+"/api/artwork/upload" ||
      process.env.RMT_TOKEN_ARTWORK!=="owner-upload-v1" || (process.env.CONTEXT && process.env.CONTEXT!=="production")) return fail("Publishing is unavailable.",404);
    requireProfileRequest(request,config,true);
    const auth=await requireAuthentication(request,await profileFirebase(config));
    requireCsrf(request,auth);
    if(auth.account.walletAddress.toLowerCase()!==rmtCreationOwner.toLowerCase()) return fail("Use the RMT owner account.",403);
    let meta;
    try {
      const input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await boundedBytes(request.body,4096)));
      meta=descriptionMetadata(input.description);
      if(input.cid!==meta.cid) return fail("Review the updated description.",409);
    } catch {return fail("Invalid description or metadata.",422);}
    const store=configuredArtworkStore();
    if(!(await readArtwork(store,rmtImageCID,"image.webp")).ok) return fail("Original artwork could not be verified.",503);
    if(!await reserve(store,rmtCreationOwner,meta.cid,Date.now())) return fail("Daily publication limit reached.",429);
    await store.set("objects/"+meta.cid,meta.bytes.buffer,{onlyIfNew:true});
    if(!(await readArtwork(store,meta.cid,"metadata.json")).ok) return fail("Metadata could not be verified.",503);
    return Response.json({projectURI:meta.projectURI,artworkURL:meta.artworkURL},{headers:{"Cache-Control":"no-store"}});
  } catch(e){return e instanceof ProfileError?fail(e.message,e.status):fail("Metadata publication unavailable.",503);}
}
