/** Only a source location for an exact locally generated fixture assertion.
 * Never print an upstream message, RPC URL, request, cause or raw stack. */
export function localReclaimSourceDiagnostic(error:unknown,chainId:number,moduleEnabled:boolean):string|null{
  if(chainId!==31337||!moduleEnabled||!(error instanceof Error)
    ||error.message!=="Fixture reclaim evidence unavailable or conflicting")return null;
  const locations:string[]=[];
  for(const line of(error.stack??"").split("\n").slice(1,16)){
    const location=/(?:^|[\\/])(reclaim-fixture-(?:evidence|origin|store)\.(?:ts|js):[0-9]{1,6}:[0-9]{1,6})\)?$/.exec(line.trim())?.[1];
    if(location&&!locations.includes(location))locations.push(location);
    if(locations.length===4)break;
  }
  return locations.length?"Fixture reclaim source locations: "+locations.join(", "):null;
}
