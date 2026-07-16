export type InclusiveBlockRange = Readonly<{
  fromBlock: bigint;
  toBlock: bigint;
}>;

export type InclusiveBlockRangePlan = Readonly<{
  fromBlock: bigint;
  toBlock: bigint;
  maxBlocks: bigint;
}>;

export const MAX_INCLUSIVE_BLOCK_RANGE_SIZE = 2_000n;
export const MAX_INCLUSIVE_BLOCK_RANGE_COUNT = 10_000n;

export function planInclusiveBlockRanges(
  plan: InclusiveBlockRangePlan
): readonly InclusiveBlockRange[] {
  if (plan.fromBlock < 0n || plan.toBlock < 0n) {
    throw new Error("Block ranges must be nonnegative");
  }
  if (plan.toBlock < plan.fromBlock) {
    throw new Error("Block range end must not precede its start");
  }
  if (plan.maxBlocks < 1n) {
    throw new Error("Block range size must be positive");
  }
  if (plan.maxBlocks > MAX_INCLUSIVE_BLOCK_RANGE_SIZE) {
    throw new Error("Block range size exceeds the safety bound");
  }

  const span = plan.toBlock - plan.fromBlock + 1n;
  const rangeCount = (span + plan.maxBlocks - 1n) / plan.maxBlocks;
  if (rangeCount > MAX_INCLUSIVE_BLOCK_RANGE_COUNT) {
    throw new Error("Block range plan exceeds the allocation safety bound");
  }

  const ranges: InclusiveBlockRange[] = [];
  let cursor = plan.fromBlock;
  while (cursor <= plan.toBlock) {
    const toBlock =
      cursor + plan.maxBlocks - 1n < plan.toBlock
        ? cursor + plan.maxBlocks - 1n
        : plan.toBlock;
    ranges.push(Object.freeze({ fromBlock: cursor, toBlock }));
    cursor = toBlock + 1n;
  }
  return Object.freeze(ranges);
}
