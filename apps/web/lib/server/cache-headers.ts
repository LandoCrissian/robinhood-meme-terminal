type SharedCachePolicy = {
  browserMaxAgeSeconds?: number;
  sharedMaxAgeSeconds: number;
  staleIfErrorSeconds?: number;
  staleWhileRevalidateSeconds?: number;
};

function nonnegativeInteger(value: number | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return value;
}

export function sharedCacheHeaders(policy: SharedCachePolicy) {
  const browserMaxAge = nonnegativeInteger(policy.browserMaxAgeSeconds ?? 2, "browserMaxAgeSeconds");
  const sharedMaxAge = nonnegativeInteger(policy.sharedMaxAgeSeconds, "sharedMaxAgeSeconds");
  const staleWhileRevalidate = nonnegativeInteger(
    policy.staleWhileRevalidateSeconds,
    "staleWhileRevalidateSeconds"
  );
  const staleIfError = nonnegativeInteger(policy.staleIfErrorSeconds, "staleIfErrorSeconds");

  const sharedDirectives = [
    "public",
    `s-maxage=${sharedMaxAge}`,
    ...(staleWhileRevalidate === undefined ? [] : [`stale-while-revalidate=${staleWhileRevalidate}`]),
    ...(staleIfError === undefined ? [] : [`stale-if-error=${staleIfError}`])
  ];
  const browserDirectives = ["public", `max-age=${browserMaxAge}`, ...sharedDirectives.slice(1)];

  return {
    "Cache-Control": browserDirectives.join(", "),
    "CDN-Cache-Control": sharedDirectives.join(", "),
    "Vercel-CDN-Cache-Control": sharedDirectives.join(", ")
  };
}
