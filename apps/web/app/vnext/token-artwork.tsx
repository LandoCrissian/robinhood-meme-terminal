"use client";

import { useState } from "react";
import { safeTokenArtworkUrl } from "../../lib/vnext/token-artwork";

export function TokenArtwork({ symbol, imageUrl, className, contract, launch }: {
  symbol: string;
  imageUrl?: string | null;
  className: string;
  contract?: string;
  launch?: boolean;
}) {
  const existingImage = safeTokenArtworkUrl(imageUrl);
  const safeImage = existingImage === "/brand/rmt-master-logo.png" ? existingImage : contract
    ? `/api/vnext/token-artwork?${new URLSearchParams({ address: contract, ...(launch?{launch:"1"}:{}), ...(existingImage?.startsWith("https:") ? { legacy: existingImage } : {}), ...(imageUrl ? { revision: String([...imageUrl].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)) } : {}) })}`
    : existingImage;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);

  return <span className={className} aria-hidden="true" style={launch ? { position: "relative" } : undefined}>
    {launch ? <span>{symbol.trim().slice(0, 1).toUpperCase() || "?"}</span> : null}
    {safeImage && failedImage !== safeImage
      ? <img src={safeImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={launch ? { position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:loadedImage===safeImage?1:0 } : undefined} onLoad={launch ? () => setLoadedImage(safeImage) : undefined} onError={() => setFailedImage(safeImage)} />
      : launch ? null : (symbol.trim().slice(0, 1).toUpperCase() || "?")}
  </span>;
}
