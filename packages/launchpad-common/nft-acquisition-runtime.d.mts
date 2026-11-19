export const nftAcquisitionProfile: "rmt-nft-acquisition-local-v1";
export const nftAcquisitionVenueDomainName: "RMT Synthetic NFT Listing Venue";
export const nftAcquisitionOrder: string;
export const nftAcquisitionPolicy: string;
export const nftAcquisitionFactorySignatures: readonly string[];
export const nftAcquisitionVaultSignatures: readonly string[];
export const nftAcquisitionVenueSignatures: readonly string[];
export const nftAcquisitionOrderTypes: { readonly Order: readonly { readonly name: string; readonly type: string }[] };
export function materializeNftAcquisitionRuntime(template: string, references: Record<string, {start:number;length:number}[]>, names: Record<string,string>, values: Record<string,unknown>): `0x${string}`;
