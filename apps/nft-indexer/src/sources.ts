import { RMT_NFT_ACTIVITY_SOURCES, type RmtNftActivitySource } from '@rmt/shared/nft/activity-sources';

// Project intake is deliberately absent: only the reviewed activity-source manifest is runtime input.
export const NFT_INDEXER_SOURCES: readonly RmtNftActivitySource[] = RMT_NFT_ACTIVITY_SOURCES;

function sourceKey(source: RmtNftActivitySource) {
  return [
    source.chainId,
    source.projectId,
    source.collectionAddress.toLowerCase(),
    source.standard,
    source.deploymentTransaction.toLowerCase(),
    source.startBlock
  ].join(':');
}

export function assertExactReviewedSourceSet(
  reviewedSources: readonly RmtNftActivitySource[],
  suppliedSources: readonly RmtNftActivitySource[]
) {
  const reviewed = new Set<string>();
  for (const source of reviewedSources) {
    const key = sourceKey(source);
    if (reviewed.has(key)) throw new Error('Reviewed NFT activity-source manifest contains a duplicate source key');
    reviewed.add(key);
  }

  const supplied = new Set<string>();
  for (const source of suppliedSources) {
    const key = sourceKey(source);
    if (supplied.has(key)) throw new Error('NFT indexer runtime source set contains a duplicate source key');
    if (!reviewed.has(key)) throw new Error('NFT indexer source is not in the reviewed activity-source manifest');
    supplied.add(key);
  }
  for (const key of reviewed) {
    if (!supplied.has(key)) throw new Error('NFT indexer runtime source set omits a reviewed activity source');
  }
}

export function assertReviewedSourceSet(sources: readonly RmtNftActivitySource[]) {
  assertExactReviewedSourceSet(RMT_NFT_ACTIVITY_SOURCES, sources);
}
