"use client";

import { useState } from "react";
import { safeTokenArtworkUrl } from "../../lib/vnext/token-artwork";

export function TokenArtwork({ symbol, imageUrl, className, contract, launch, scanner }: {
  symbol: string;
  imageUrl?: string | null;
  className: string;
  contract?: string;
  launch?: boolean;
  scanner?: boolean;
}) {
  const existingImage = safeTokenArtworkUrl(imageUrl);
  const safeImage = existingImage === "/brand/rmt-master-logo.png" ? existingImage : contract
    ? `/api/vnext/token-artwork?${new URLSearchParams({ address: contract, ...(launch?{launch:"1"}:{}), ...(existingImage?.startsWith("https:") ? { legacy: existingImage } : {}), ...(imageUrl ? { revision: String([...imageUrl].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)) } : {}) })}`
    : existingImage;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const stable = launch || scanner;
  const imageStyle = { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const };

  return <span className={className} aria-hidden="true" style={stable ? { position: "relative" } : undefined}>
    {stable ? <span>{symbol.trim().slice(0, 1).toUpperCase() || "?"}</span> : null}
    {stable && loadedImage && loadedImage !== safeImage ? <img key={loadedImage} src={loadedImage} alt="" referrerPolicy="no-referrer" style={imageStyle} /> : null}
    {safeImage && failedImage !== safeImage
      ? <img key={stable ? safeImage : undefined} src={safeImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={stable ? { ...imageStyle, opacity:loadedImage===safeImage?1:0 } : undefined} onLoad={stable ? () => setLoadedImage(safeImage) : undefined} onError={() => setFailedImage(safeImage)} />
      : stable ? null : (symbol.trim().slice(0, 1).toUpperCase() || "?")}
  </span>;
}
