import { RMT_NFT_ACTIVITY_SOURCES, type RmtNftActivitySource } from '@rmt/shared/nft/activity-sources';

// Project intake is deliberately absent: only the reviewed activity-source manifest is runtime input.
export const NFT_INDEXER_SOURCES: readonly RmtNftActivitySource[] = RMT_NFT_ACTIVITY_SOURCES;

export function assertReviewedSourceSet(sources: readonly RmtNftActivitySource[]) {
  const reviewed = new Set(RMT_NFT_ACTIVITY_SOURCES.map((source) =>
    `${source.chainId}:${source.collectionAddress.toLowerCase()}:${source.deploymentTransaction.toLowerCase()}:${source.startBlock}`
  ));
  for (const source of sources) {
    const key = `${source.chainId}:${source.collectionAddress.toLowerCase()}:${source.deploymentTransaction.toLowerCase()}:${source.startBlock}`;
    if (!reviewed.has(key)) throw new Error('NFT indexer source is not in the reviewed activity-source manifest');
  }
  if (sources.length !== reviewed.size) throw new Error('NFT indexer must verify every reviewed activity source');
}
