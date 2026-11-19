import {validSeaportSafeProposal,validSeaportSafeOuter,seaportSafeVerificationMatches,type SeaportSafeProposal,type SeaportSafeApproval,type SeaportSafeOuterReview,type SeaportSafeVerification} from "./seaport-acquisition-safe";
export type SeaportSafeJournal={schemaVersion:1;proposal:SeaportSafeProposal;approvals:SeaportSafeApproval[];outer:SeaportSafeOuterReview|null;stage:"proposal"|"approvals-ready"|"awaiting-wallet"|"wallet-rejected"|"hash-missing"|"pending"|"confirmed"|"reverted"|"unavailable"|"reorged";transactionHash:string|null;result:SeaportSafeVerification|null;createdAt:number;updatedAt:number};
const prefix="rmt.seaport-safe-admin.v1:31337:";
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const key=(p:SeaportSafeProposal)=>prefix+p.vault.toLowerCase()+":"+p.safe.toLowerCase()+":"+p.proposalHash;
export function validSeaportSafeJournal(value:unknown):value is SeaportSafeJournal{try{
 const j=value as SeaportSafeJournal;
 return j.schemaVersion===1&&validSeaportSafeProposal(j.proposal)&&Array.isArray(j.approvals)&&j.approvals.length<=2
 &&j.approvals.every(a=>j.proposal.owners.some(o=>same(o,a.signer))&&/^0x[0-9a-f]{130}$/i.test(a.signature))&&new Set(j.approvals.map(a=>a.signer.toLowerCase())).size===j.approvals.length
 &&["proposal","approvals-ready","awaiting-wallet","wallet-rejected","hash-missing","pending","confirmed","reverted","unavailable","reorged"].includes(j.stage)
 &&Number.isSafeInteger(j.createdAt)&&Number.isSafeInteger(j.updatedAt)&&j.createdAt>0&&j.updatedAt>=j.createdAt
 &&(j.transactionHash===null||/^0x[0-9a-f]{64}$/i.test(j.transactionHash))
 &&(j.outer===null||validSeaportSafeOuter(j.outer)&&j.outer.proposal.proposalHash===j.proposal.proposalHash)
 &&(!["awaiting-wallet","wallet-rejected","hash-missing","pending","confirmed","reverted","unavailable","reorged"].includes(j.stage)||j.outer!==null)
 &&(j.result===null||!!j.outer&&seaportSafeVerificationMatches(j.outer,j.result,j.transactionHash??undefined));
}catch{return false;}}
export function listSeaportSafeJournals(storage:Storage,vault:string):SeaportSafeJournal[]{
 const all:SeaportSafeJournal[]=[];let count=0;for(let i=0;i<storage.length;i++){const k=storage.key(i);if(!k?.startsWith(prefix+vault.toLowerCase()+":"))continue;if(++count>32)throw Error("Safe journal bound exceeded; preserve original authorizations");
 const raw=storage.getItem(k);if(!raw||raw.length>65536)throw Error("Safe journal bytes unavailable");const j=JSON.parse(raw);if(!validSeaportSafeJournal(j)||key(j.proposal)!==k)throw Error("Safe journal identity unavailable");all.push(j);}
 return all.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function storeSeaportSafeJournal(storage:Storage,j:SeaportSafeJournal){
 if(!validSeaportSafeJournal(j))throw Error("Invalid Safe recovery record");const all=listSeaportSafeJournals(storage,j.proposal.vault),prior=all.find(x=>x.proposal.proposalHash===j.proposal.proposalHash);
 if(!prior&&all.length>=32)throw Error("Safe recovery is full; original approvals are retained");
 if(prior&&(j.createdAt!==prior.createdAt||j.updatedAt<prior.updatedAt||prior.transactionHash!==null&&(j.transactionHash===null||!same(j.transactionHash,prior.transactionHash))))throw Error("Original Safe transaction identity cannot change");
 const body=JSON.stringify(j);if(body.length>65536)throw Error("Safe journal exceeds its byte bound");storage.setItem(key(j.proposal),body);if(storage.getItem(key(j.proposal))!==body)throw Error("Safe journal must be saved before the wallet request");
}
export function reconcileSeaportSafeJournal(j:SeaportSafeJournal,r:SeaportSafeVerification):SeaportSafeJournal{
 if(!j.outer||!seaportSafeVerificationMatches(j.outer,r,j.transactionHash??undefined))throw Error("Safe recovery identity conflict");
 const canonical=r.status==="confirmed"||r.status==="reverted",transactionHash=j.transactionHash??(canonical?r.transactionHash??null:null);
 const next={...j,stage:r.status==="reorged"||r.status==="unavailable"?"pending" as const:r.status,transactionHash,result:r,updatedAt:Date.now()};
 if(!validSeaportSafeJournal(next))throw Error("Safe recovery record unavailable");return next;
}
export function assertSeaportSafeSubmissionAvailable(storage:Storage,vault:string,safe:string,payer:string,except?:string){
 if(listSeaportSafeJournals(storage,vault).some(j=>j.proposal.proposalHash!==except&&["awaiting-wallet","hash-missing","pending","unavailable","reorged"].includes(j.stage)
  &&(same(j.proposal.safe,safe)||same(j.proposal.gasPayer,payer))))throw Error("Recover the exact original Safe authorization before another submission");
}
