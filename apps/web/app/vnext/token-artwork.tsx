"use client";

import { useState } from "react";
import { safeTokenArtworkUrl } from "../../lib/vnext/token-artwork";

export function TokenArtwork({ symbol, imageUrl, className }: {
  symbol: string;
  imageUrl?: string | null;
  className: string;
}) {
  const safeImage = safeTokenArtworkUrl(imageUrl);
  const [failedImage, setFailedImage] = useState<string | null>(null);

  return <span className={className} aria-hidden="true">
    {safeImage && failedImage !== safeImage
      ? <img src={safeImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(safeImage)} />
      : (symbol.trim().slice(0, 1).toUpperCase() || "?")}
  </span>;
}
