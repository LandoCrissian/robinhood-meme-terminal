import {validSeaportReview,type SeaportAcquisitionReview} from "./seaport-acquisition";
export type SeaportJournal={review:SeaportAcquisitionReview;stage:"awaiting-wallet"|"pending"|"hash-missing"|"confirmed"|"reverted"|"wallet-rejected";hash?:string;updatedAt:number};
const prefix="rmt.seaport-acquisition.pending.v2:31337:";
const scope=(vault:string)=>prefix+vault.toLowerCase()+":";
export function loadSeaportJournal(storage:Storage,vault:string):SeaportJournal|undefined{
  const entries:SeaportJournal[]=[];let count=0;for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(scope(vault)))continue;if(++count>32)throw Error("Recovery journal bound exceeded");try{const raw=storage.getItem(key)??"null";if(raw.length>65536)continue;const value=JSON.parse(raw)as SeaportJournal;if(validSeaportReview(value.review)&&value.review.vault.toLowerCase()===vault.toLowerCase()&&Number.isSafeInteger(value.updatedAt)&&["awaiting-wallet","pending","hash-missing","confirmed","reverted","wallet-rejected"].includes(value.stage))entries.push(value);}catch{}}
  return entries.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
}
export function saveSeaportJournal(storage:Storage,value:Omit<SeaportJournal,"updatedAt">):SeaportJournal{
  if(!validSeaportReview(value.review))throw Error("Invalid original Seaport review");
  const r=value.review,key=scope(r.vault)+r.account.toLowerCase()+":"+r.reviewHash.toLowerCase(),keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>!!k&&k.startsWith(scope(r.vault)));
  if(!storage.getItem(key)&&keys.length>=32)throw Error("Recovery journal full; preserve the original records");
  const saved={...value,updatedAt:Date.now()},raw=JSON.stringify(saved);if(raw.length>65536)throw Error("Recovery journal request bound exceeded");storage.setItem(key,raw);return saved;
}
