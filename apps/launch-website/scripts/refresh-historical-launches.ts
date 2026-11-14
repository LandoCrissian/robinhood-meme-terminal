import { verifyHistoricalLaunches } from "../lib/server/verify-historical-launches";

async function main() {
  const [block, ...extra] = process.argv.slice(2);
  if (extra.length || (block !== undefined && !/^[1-9][0-9]{0,14}$/.test(block))) {
    throw new Error("Pass an optional decimal Robinhood Chain checkpoint block number");
  }
  const snapshot = await verifyHistoricalLaunches(block);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown verification error";
  console.error(`Historical launch verification failed: ${message}`);
  process.exitCode = 1;
});
