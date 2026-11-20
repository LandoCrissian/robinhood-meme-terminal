import {createHash} from "node:crypto";
const hash=/^0x[0-9a-f]{64}$/i;
const held=reason=>({status:"UNAVAILABLE",reason,entries:[],publicListingVerified:false,executionEnabled:false});
/** Host-owned, bounded import source. This adapter does not fetch URLs, crawl
 * marketplaces, import policies, verify orders or submit transactions. A host
 * supplies explicit seller/owner-published bytes; admission is a separate step.
 * Listing summaries and authenticated APIs without permission remain unusable.
 */
export function createNativeOwnerImportFeed({policyCatalogHash,readImports}){
 if(!hash.test(policyCatalogHash)||typeof readImports!=="function")throw Error("NATIVE_IMPORT_FEED_UNASSIGNED");
 const catalog=policyCatalogHash.toLowerCase();
 return async function discover({binding,signal}){
  if(signal?.aborted)return held("SOURCE_READ_ABORTED");
  if(binding?.nativeAdmission?.sourceId!=="owner-supplied"||binding.nativeAdmission.policyCatalogHash?.toLowerCase()!==catalog)return held("SOURCE_POLICY_BINDING_MISMATCH");
  try{
   const imports=await readImports({signal});
   if(signal?.aborted)return held("SOURCE_READ_ABORTED");
   if(!Array.isArray(imports)||imports.length>8)return held("SOURCE_IMPORT_BOUND");
   const entries=[],seen=new Set();let bytes=0;
   for(const rawUtf8 of imports){
    if(typeof rawUtf8!=="string")return held("SOURCE_IMPORT_BYTES_REQUIRED");
    const entry={sourceKind:"OWNER_SUPPLIED",sourceId:"owner-supplied",rawUtf8},size=Buffer.byteLength(JSON.stringify(entry));
    bytes+=size;if(size>32768||bytes>262144)return held("SOURCE_IMPORT_BOUND");
    const digest=createHash("sha256").update(rawUtf8).digest("hex");
    if(!seen.has(digest)){seen.add(digest);entries.push(Object.freeze(entry));}
   }
   return{status:"AVAILABLE",entries,sourceId:"owner-supplied",policyCatalogHash:catalog,publicListingVerified:false,executionEnabled:false};
  }catch{return held("OWNER_IMPORT_SOURCE_UNAVAILABLE");}
 };
}
