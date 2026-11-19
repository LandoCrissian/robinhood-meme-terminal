// V2-only transaction proof. The Task082 read-only verifier remains unchanged.
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toLowerCase()===b.toLowerCase();
const address=v=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v);
const bytes=v=>typeof v==="string"&&/^0x(?:[0-9a-f]{2}){0,65536}$/i.test(v);
const need=v=>{if(!v)throw Error("Seaport V2 exact transaction proof unavailable or conflicting");};

/** Complete call tree, exact fulfillment, custody call and complete payment
 * multiset. Net block deltas cannot attribute two purchases in one block. */
export function assertSeaportVaultTrace(raw,origin,expected){
  need(address(origin.from)&&address(origin.to)&&bytes(origin.input)&&origin.value===0n);
  need(address(expected.vault)&&address(expected.seaport)&&address(expected.collection)
    &&bytes(expected.purchaseInput)&&bytes(expected.fulfillInput)&&bytes(expected.nftTransferInput)
    &&typeof expected.total==="bigint"&&expected.total>0n&&Array.isArray(expected.payments)
    &&expected.payments.length>=1&&expected.payments.length<=8);
  const flat=[];
  function visit(node,parent,depth){
    need(flat.length<2048&&depth<=48&&node&&typeof node==="object"&&!Array.isArray(node)
      &&["CALL","STATICCALL","DELEGATECALL"].includes(node.type)&&node.error===undefined
      &&address(node.from)&&address(node.to)&&bytes(node.input??"0x")
      &&(node.calls===undefined||Array.isArray(node.calls)));
    const amount=node.value??(node.type==="DELEGATECALL"?"0x"+(parent?.amount??0n).toString(16):node.type==="STATICCALL"?"0x0":null);
    need(typeof amount==="string"&&/^0x[0-9a-f]{1,64}$/i.test(amount));
    need(!parent||same(node.from,parent.type==="DELEGATECALL"?parent.from:parent.to));
    const item={...node,input:node.input??"0x",amount:BigInt(amount)};flat.push(item);
    if(item.type==="DELEGATECALL")need(parent&&item.amount===parent.amount&&Array.isArray(expected.admittedSafeDelegates)&&expected.admittedSafeDelegates.some(pin=>address(pin.proxy)&&address(pin.singleton)&&same(item.from,pin.proxy)&&same(item.to,pin.singleton)));
    if(item.type==="STATICCALL")need(item.amount===0n);
    for(const child of node.calls??[])visit(child,item,depth+1);
    return item;
  }
  const root=visit(raw,null,0);need(root.type==="CALL"&&same(root.from,origin.from)&&same(root.to,origin.to)&&same(root.input,origin.input)&&root.amount===0n);
  const purchases=flat.filter(n=>n.type==="CALL"&&same(n.to,expected.vault)&&same(n.input,expected.purchaseInput));
  need(purchases.length===1&&same(purchases[0].input,expected.purchaseInput)&&purchases[0].amount===0n);
  const fills=flat.filter(n=>n.type==="CALL"&&same(n.from,expected.vault)&&same(n.to,expected.seaport));
  need(fills.length===1&&same(fills[0].input,expected.fulfillInput)&&fills[0].amount===(expected.native?expected.total:0n));
  const nft=flat.filter(n=>n.type==="CALL"&&same(n.from,expected.seaport)&&same(n.to,expected.collection));
  need(nft.length===1&&same(nft[0].input,expected.nftTransferInput)&&nft[0].amount===0n);
  const actual=new Map(),wanted=new Map();
  const add=(m,from,to,value)=>{const key=from.toLowerCase()+":"+to.toLowerCase();m.set(key,(m.get(key)??0n)+value);};
  for(const n of flat)if(n.type==="CALL"&&n.amount>0n)add(actual,n.from,n.to,n.amount);
  let total=0n;const recipients=new Set();
  for(const p of expected.payments){need(address(p.recipient)&&typeof p.amount==="bigint"&&p.amount>0n&&!recipients.has(p.recipient.toLowerCase()));recipients.add(p.recipient.toLowerCase());total+=p.amount;if(expected.native)add(wanted,expected.seaport,p.recipient,p.amount);}
  need(total===expected.total);if(expected.native)add(wanted,expected.vault,expected.seaport,total);
  need(actual.size===wanted.size);for(const[k,v]of wanted)need(actual.get(k)===v);
  if(!expected.native){
    need(address(expected.currency)&&Array.isArray(expected.tokenTransferInputs)&&expected.tokenTransferInputs.length===expected.payments.length);
    const transfers=flat.filter(n=>n.type==="CALL"&&same(n.from,expected.seaport)&&same(n.to,expected.currency));
    need(transfers.length===expected.tokenTransferInputs.length);
    for(let i=0;i<transfers.length;i++)need(same(transfers[i].input,expected.tokenTransferInputs[i])&&transfers[i].amount===0n&&transfers[i].output==="0x"+"0".repeat(63)+"1");
  }
  return{evidence:"canonical-receipt-and-exact-local-call-trace",frames:flat.length,nativeTransfers:actual.size};
}
