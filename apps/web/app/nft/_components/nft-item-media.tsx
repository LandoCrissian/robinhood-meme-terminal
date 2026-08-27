import Image from "next/image";
import type { RmtNftItemMetadata } from "@rmt/shared/nft/project-inventory";

export function NftItemMedia({ metadata, alt, className }: { metadata: RmtNftItemMetadata; alt: string; className: string }) {
  if (metadata.status !== "READY" || !metadata.image) {
    return <div className={className} role="img" aria-label={`${alt} media unavailable`}><span>MEDIA<br />UNAVAILABLE</span></div>;
  }
  return <div className={className}>
    <Image src={metadata.image} alt={alt} width={720} height={720} sizes="(max-width: 700px) 92vw, 360px" unoptimized />
  </div>;
}
