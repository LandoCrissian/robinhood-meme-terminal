import assert from 'node:assert/strict';
import { loadNftIndexerConfig } from './config.js';
import { isNftIndexerReadAuthorized } from './server.js';

const valid = {
  NFT_INDEXER_DATABASE_URL: 'postgres://nft:secret@localhost:5432/rmt_nft_indexer?sslmode=disable',
  NFT_INDEXER_RPC_URL: 'https://rpc.example.test/',
  NFT_INDEXER_FINALITY_DEPTH: '64',
  NFT_INDEXER_READ_TOKEN: 'a'.repeat(64)
} as NodeJS.ProcessEnv;

assert.throws(() => loadNftIndexerConfig({ NFT_INDEXER_RPC_URL: valid.NFT_INDEXER_RPC_URL }), /DATABASE_URL is required/);
assert.throws(() => loadNftIndexerConfig({ ...valid, NFT_INDEXER_DATABASE_URL: 'not-a-url' }), /valid PostgreSQL URL/);
for (const collision of ['DATABASE_URL', 'MARKET_INDEXER_DATABASE_URL', 'EXTERNAL_ORIGIN_DATABASE_URL']) {
  assert.throws(() => loadNftIndexerConfig({ ...valid, [collision]: valid.NFT_INDEXER_DATABASE_URL }), new RegExp(`must not equal ${collision}`));
}
assert.throws(() => loadNftIndexerConfig({
  ...valid,
  MARKET_INDEXER_DATABASE_URL: 'postgresql://other-user@localhost/rmt_nft_indexer?sslmode=verify-full'
}), /must not equal MARKET_INDEXER_DATABASE_URL/);
assert.throws(() => loadNftIndexerConfig({ ...valid, NFT_INDEXER_RPC_URL: 'http://rpc.example.test' }), /must use HTTPS/);
assert.throws(() => loadNftIndexerConfig({ ...valid, NFT_INDEXER_RPC_URL: 'https://user:pass@rpc.example.test' }), /without embedded credentials/);
const { NFT_INDEXER_FINALITY_DEPTH: _missingFinality, ...withoutFinality } = valid;
assert.throws(() => loadNftIndexerConfig(withoutFinality), /NFT_INDEXER_FINALITY_DEPTH is required/);
assert.throws(() => loadNftIndexerConfig({ ...valid, NFT_INDEXER_READ_TOKEN: undefined }), /NFT_INDEXER_READ_TOKEN is required/);
assert.throws(() => loadNftIndexerConfig({ ...valid, NFT_INDEXER_READ_TOKEN: 'short' }), /32 to 512/);
for (const [name, value] of [
  ['NFT_INDEXER_FINALITY_DEPTH', '-1'], ['NFT_INDEXER_BATCH_SIZE', '0'],
  ['NFT_INDEXER_MAX_BATCHES_PER_CYCLE', '513'], ['NFT_INDEXER_POLL_INTERVAL_MS', '12.5']
] as const) assert.throws(() => loadNftIndexerConfig({ ...valid, [name]: value }), new RegExp(name));

const config = loadNftIndexerConfig(valid);
assert.equal(config.finalityDepth, 64);
assert.equal(config.batchSize, 2_000);
assert.equal(isNftIndexerReadAuthorized(`Bearer ${valid.NFT_INDEXER_READ_TOKEN}`, valid.NFT_INDEXER_READ_TOKEN!), true);
assert.equal(isNftIndexerReadAuthorized('Bearer wrong-token', valid.NFT_INDEXER_READ_TOKEN!), false);
console.info('nft-indexer config smoke: PASS');
