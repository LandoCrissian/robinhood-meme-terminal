const MAX_CAUSE_DEPTH = 8;

type ErrorLike = {
  code?: unknown;
  name?: unknown;
  cause?: unknown;
};

export function isVNextUserRejectedRequest(value: unknown) {
  const visited = new Set<object>();
  let current: unknown = value;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== "object" || visited.has(current)) return false;
    visited.add(current);
    const candidate = current as ErrorLike;
    if (candidate.code === 4001 || candidate.name === "UserRejectedRequestError") return true;
    current = candidate.cause;
  }
  return false;
}
