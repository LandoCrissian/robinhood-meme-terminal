import type { PoolClient } from "pg";
import type { PublicClient, Hex } from "viem";
import type { LaunchEvidence } from "@rmt/shared/launch-intelligence";
import { launchTokenAbi } from "./launch-domain.js";
type IdentityRecord = {
  identity: LaunchEvidence["identity"];
  identityObservations: NonNullable<LaunchEvidence["identityObservations"]>;
};
/** The existing Multicall3 authority is also used by the canonical token producer.
 * One bounded shared batch; no per-browser RPC and no full supply certification. */
export async function refreshLaunchIdentities(
  client: PoolClient,
  rpc: PublicClient,
  block: bigint,
  blockHash: Hex,
) {
  const rows = (
    await client.query<{
      token: Hex;
      payload: IdentityRecord | null;
    }>(`WITH tokens AS (
      SELECT payload->'creation'->>'token' AS token,MAX(block_number) AS launch_block FROM rmt_launch_events
      WHERE payload->'creation' IS NOT NULL AND payload->'creation'<>'null'::jsonb GROUP BY 1
    ) SELECT t.token,i.payload FROM tokens t LEFT JOIN rmt_launch_identities i ON i.token=t.token
    WHERE i.token IS NULL OR (i.retry_after IS NOT NULL AND i.retry_after<NOW())
      OR (i.retry_after IS NULL AND i.refreshed_at<NOW()-INTERVAL '1 hour')
    ORDER BY i.refreshed_at ASC NULLS FIRST,t.launch_block DESC,t.token LIMIT 25`)
  ).rows;
  if (!rows.length) return;
  try {
    const result = await rpc.multicall({
      multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
      allowFailure: true,
      blockNumber: block,
      batchSize: 8192,
      contracts: rows.flatMap((row) =>
        (["name", "symbol", "decimals", "logo"] as const).map(
          (functionName) => ({
            address: row.token,
            abi: launchTokenAbi,
            functionName,
          }),
        ),
      ),
    });
    if ((await rpc.getBlock({ blockNumber: block })).hash !== blockHash)
      throw new Error("launch identity observation reorganized");
    await client.query("BEGIN");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!,
        record: IdentityRecord = row.payload ?? {
          identity: { name: null, symbol: null, decimals: null, artwork: null },
          identityObservations: {},
        };
      let resolved = 0;
      for (const [offset, name] of (
        ["name", "symbol", "decimals", "artwork"] as const
      ).entries()) {
        const read = result[i * 4 + offset];
        if (read?.status !== "success") continue;
        const value = read.result;
        if (name === "decimals") {
          if (typeof value !== "number" || value < 0 || value > 36) continue;
          record.identity.decimals = value;
        } else {
          if (
            typeof value !== "string" ||
            !value.trim() ||
            value.length >
              (name === "name" ? 80 : name === "symbol" ? 20 : 2048)
          )
            continue;
          const text = value.trim();
          if (name === "artwork" && !/^(https:\/\/|ipfs:\/\/)/i.test(text))
            continue;
          record.identity[name] = text;
        }
        record.identityObservations[name] = {
          block: String(block),
          blockHash,
          observedAt: new Date().toISOString(),
        };
        resolved++;
      }
      await client.query(
        `INSERT INTO rmt_launch_identities(token,block_number,payload,retry_after) VALUES($1,$2,$3,CASE WHEN $4 THEN NULL ELSE NOW()+INTERVAL '1 minute' END)
        ON CONFLICT(token) DO UPDATE SET block_number=EXCLUDED.block_number,payload=EXCLUDED.payload,refreshed_at=NOW(),retry_after=EXCLUDED.retry_after`,
        [row.token, String(block), JSON.stringify(record), resolved > 0],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    // Failed attempts never become new identity observations. Retain each
    // category's original proof and prevent an unavailable batch hot loop.
    for (const row of rows)
      await client.query(
        `INSERT INTO rmt_launch_identities(token,block_number,payload,retry_after)
      VALUES($1,0,$2,NOW()+INTERVAL '1 minute') ON CONFLICT(token) DO UPDATE SET retry_after=EXCLUDED.retry_after`,
        [
          row.token,
          JSON.stringify(
            row.payload ?? {
              identity: {
                name: null,
                symbol: null,
                decimals: null,
                artwork: null,
              },
              identityObservations: {},
            },
          ),
        ],
      );
    console.warn(
      JSON.stringify({
        event: "launch_identity_delayed",
        operation: "metadata_multicall",
        errorClass: error instanceof Error ? error.name : "Error",
      }),
    );
  }
}
