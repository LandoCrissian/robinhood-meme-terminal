export const reclaimFactorySignatures: readonly string[];
export const reclaimCampaignSignatures: readonly string[];
export function materializeReclaimRuntime(template:string,references:Record<string,{start:number;length:number}[]>,names:Record<string,string>,fields:{
  creator:string;rewardToken:string;rewardRuntimeHash:string;deploymentChainId:number;deploymentFactory:string;
}):`0x${string}`;
export function buildReclaimEligibility(fields:{chainId:31337|4663;campaign:string;collection:string;runtimeHash:string;standard:1|2;items:{tokenId:string;maxQuantity:string}[]},codecs:{
  keccak256:(value:`0x${string}`)=>`0x${string}`;
  encodeAbiParameters:(types:readonly{type:string}[],values:readonly unknown[])=>`0x${string}`;
}):{root:`0x${string}`;items:{tokenId:string;maxQuantity:string;proof:`0x${string}`[]}[]};
