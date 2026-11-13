export function TokenArtwork({ symbol }: { symbol: string }) {
  return <span className="rmtMarketArtwork lpArtwork" aria-hidden="true">{symbol.slice(0, 2).toUpperCase()}</span>;
}
