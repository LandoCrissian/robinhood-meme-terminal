"use client";

import { useState } from "react";
import { safeTokenArtworkUrl } from "../../lib/vnext/token-artwork";

export function TokenArtwork({ symbol, imageUrl, className, contract }: {
  symbol: string;
  imageUrl?: string | null;
  className: string;
  contract?: string;
}) {
  const existingImage = safeTokenArtworkUrl(imageUrl);
  const safeImage = existingImage === "/brand/rmt-master-logo.png" ? existingImage : contract
    ? `/api/vnext/token-artwork?${new URLSearchParams({ address: contract, ...(existingImage?.startsWith("https:") ? { legacy: existingImage } : {}), ...(imageUrl ? { revision: String([...imageUrl].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)) } : {}) })}`
    : existingImage;
  const [failedImage, setFailedImage] = useState<string | null>(null);

  return <span className={className} aria-hidden="true">
    {safeImage && failedImage !== safeImage
      ? <img src={safeImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(safeImage)} />
      : (symbol.trim().slice(0, 1).toUpperCase() || "?")}
  </span>;
}
