import assert from "node:assert/strict";
import {
  DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS,
  DISTRIBUTION_PLANNER_DEFAULT_SENDER,
  DISTRIBUTION_PLANNER_MODE,
  DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL,
  buildDistributionPlannerPreview,
  formatDistributionPreviewAmount
} from "./distribution-planner";
import { MAX_DISTRIBUTION_ROWS } from "./distribution-domain";

const BASE_ROWS = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
  "0x0000000000000000000000000000000000000003",
  "0x0000000000000000000000000000000000000004"
] as const;

const nearLimitRows = Array.from({ length: MAX_DISTRIBUTION_ROWS }, (_, index) => {
  const offset = index + 1;
  return `0x${offset.toString(16).padStart(40, "0")}`;
});

const validEqual = buildDistributionPlannerPreview({
  actionKind: "erc20_equal",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS),
  equalAmount: "1",
  csv: `recipient\n${BASE_ROWS.join("\n")}\n`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(validEqual.status, "ready");
assert.equal(validEqual.totalRows, BASE_ROWS.length);
assert.equal(validEqual.validRows, BASE_ROWS.length);
assert.equal(validEqual.invalidRows, 0);
assert.equal("manifest" in validEqual, false);
assert.equal("batches" in validEqual, false);
assert.equal("estimatedUtilityCostAtomic" in validEqual, false);
assert.equal("rowsPreview" in validEqual, true);
assert.equal("estimatedAssetAmountAtomic" in validEqual, true);
assert.equal(formatDistributionPreviewAmount("erc20_equal", validEqual.decimals, validEqual.rowsPreview[0]), "1");

const validCustom = buildDistributionPlannerPreview({
  actionKind: "erc20_custom",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS),
  equalAmount: "",
  csv: `recipient,amount\n${BASE_ROWS[0]},0.5\n${BASE_ROWS[1]},2\n`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(validCustom.status, "ready");
assert.equal(validCustom.validRows, 2);

const invalidCsv = buildDistributionPlannerPreview({
  actionKind: "erc20_custom",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS),
  equalAmount: "",
  csv: `recipient,amount\n${BASE_ROWS[0]},0`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(invalidCsv.status, "error");
assert.match(invalidCsv.message, /greater than 0|minimum|rejected/i);

const duplicateRows = buildDistributionPlannerPreview({
  actionKind: "erc721",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: "",
  equalAmount: "",
  csv: `recipient,tokenId\n${BASE_ROWS[0]},1001\n${BASE_ROWS[0]},1001\n`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(duplicateRows.status, "error");
assert.match(duplicateRows.message, /duplicates/i);

const zeroValueRows = buildDistributionPlannerPreview({
  actionKind: "erc1155",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: "",
  equalAmount: "",
  csv: `recipient,tokenId,amount\n${BASE_ROWS[0]},1001,0\n`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(zeroValueRows.status, "error");
assert.match(zeroValueRows.message, /must be greater than 0|minimum|rejected/i);

const nearLimit = buildDistributionPlannerPreview({
  actionKind: "erc20_equal",
  assetAddress: DISTRIBUTION_PLANNER_DEFAULT_ASSET,
  assetDecimals: String(DISTRIBUTION_PLANNER_DEFAULT_ASSET_DECIMALS),
  equalAmount: "0.000001",
  csv: `recipient\n${nearLimitRows.join("\n")}\n`,
  senderAddress: DISTRIBUTION_PLANNER_DEFAULT_SENDER
});
assert.equal(nearLimit.status, "ready");
assert.equal(nearLimit.totalRows, MAX_DISTRIBUTION_ROWS);
assert.equal(nearLimit.invalidRows, 0);

assert.equal(DISTRIBUTION_PLANNER_MODE, "planning-only");
assert.equal(DISTRIBUTION_PLANNER_NOT_APPROVED_LABEL, "NOT APPROVED");

console.log("RMT distribution planner smoke checks passed.");
