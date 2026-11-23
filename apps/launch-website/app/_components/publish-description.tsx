import {useState} from "react";
import {useAccount} from "./account-provider";
import {descriptionMetadata} from "../../lib/rmt-metadata";
import {rmtCreationOwner} from "../../lib/owner-creation";
import {verifyArtworkReceipt, type ArtworkReceipt} from "../../lib/token-artwork";

export function PublishDescription({description, projectURI, onSave}:{description:string;projectURI:string;onSave:(receipt:ArtworkReceipt)=>void}) {
  const {session}=useAccount();
  const [review,setReview]=useState<string>(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  let meta;
  try {meta=descriptionMetadata(description);} catch {return <p>Add a description of up to 500 UTF-8 bytes to publish it with the RMT artwork.</p>;}
  if(projectURI===meta.projectURI) return <p role="status">Draft references the description and artwork metadata. <a href={projectURI}>View public metadata</a></p>;
  const receipt=meta;
  async function publish(){
    if(!session.authenticated || session.account.walletAddress.toLowerCase()!==rmtCreationOwner.toLowerCase() || review!==description || busy)return;
    setBusy(true);setMessage("Saving public metadata…");
    try {
      const result=await fetch("/api/artwork/upload",{method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),
        headers:{"Content-Type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify({description,cid:receipt.cid})});
      const value=await result.json();
      if(!result.ok)throw new Error(value.error || "Could not publish. Retry from this draft.");
      if(value.projectURI!==receipt.projectURI || value.artworkURL!==receipt.artworkURL)throw new Error("Published metadata differs from the review.");
      await verifyArtworkReceipt(value,AbortSignal.timeout(20000));onSave(value);setMessage("Public metadata saved.");
    }catch(e){setMessage(e instanceof Error?e.message:"Could not confirm publication. Retry.");}finally{setBusy(false);}
  }
  return <div>
    <button type="button" disabled={busy} onClick={()=>{setReview(description);setMessage("");}}>Review public RMT description</button>
    {review===description && <section aria-label="Review permanent metadata"><h3>Publish this description with your saved RMT artwork?</h3>
      <p style={{whiteSpace:"pre-wrap"}}>{review}</p><p className="lpAddress">{receipt.projectURI}</p>
      <p>Anyone can read the published text. Editing it later creates a different URL. Publication uses no gas.</p>
      {session.authenticated && session.account.walletAddress.toLowerCase()===rmtCreationOwner.toLowerCase()
        ? <button type="button" disabled={busy} onClick={()=>void publish()}>Publish description and artwork metadata</button>
        : <a href="/account/profile">Sign in with the RMT owner account, then return to this draft</a>}</section>}
    <p role="status">{message}</p></div>;
}
