import { mkdir, writeFile } from "node:fs/promises";
import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, parseAbi } from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const NFT = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const CCFF00 = getAddress("0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97");
const RMT = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const PUBLIC_MINTED = 482;
const BATCH_SIZE = 25;
const PAUSE_MS = 700;
const nftAbi = parseAbi([
  "function getTokenBoundAccount(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function TOKENS_PER_NFT() view returns (uint256)"
]);
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blockTag = (n) => `0x${n.toString(16)}`;
const encode = (abi, functionName, args = []) => encodeFunctionData({ abi, functionName, args });
const decode = (abi, functionName, data) => decodeFunctionResult({ abi, functionName, data });

async function fetchRetry(url, options, attempts = 12) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (response.ok) return text;
      last = new Error(`${response.status}: ${text.slice(0, 250)}`);
      await sleep(response.status === 429 ? Math.min(12_000, 1_500 * attempt) : 500 * attempt);
    } catch (error) {
      last = error;
      await sleep(500 * attempt);
    }
  }
  throw last;
}

async function rpcBatch(calls) {
  const payload = calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params }));
  const response = JSON.parse(await fetchRetry(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
  const byId = new Map(response.map((entry) => [entry.id, entry]));
  return calls.map((_, index) => {
    const entry = byId.get(index + 1);
    if (!entry) throw new Error(`missing RPC result ${index + 1}`);
    return entry.error ? { error: entry.error.message } : { result: entry.result };
  });
}

async function rpc(method, params) {
  const [entry] = await rpcBatch([{ method, params }]);
  if (entry.error) throw new Error(entry.error);
  return entry.result;
}

async function batches(items, makeCall) {
  const all = [];
  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    all.push(...await rpcBatch(items.slice(offset, offset + BATCH_SIZE).map(makeCall)));
    if (offset + BATCH_SIZE < items.length) await sleep(PAUSE_MS);
  }
  return all;
}

const snapshotBlock = BigInt(await rpc("eth_blockNumber", []));
const snapshot = blockTag(snapshotBlock);
const ids = Array.from({ length: PUBLIC_MINTED }, (_, index) => String(index + 1));
const [ccffDecimalsRaw, rmtDecimalsRaw, expectedCcffRaw] = await Promise.all([
  rpc("eth_call", [{ to: CCFF00, data: encode(erc20Abi, "decimals") }, snapshot]),
  rpc("eth_call", [{ to: RMT, data: encode(erc20Abi, "decimals") }, snapshot]),
  rpc("eth_call", [{ to: NFT, data: encode(nftAbi, "TOKENS_PER_NFT") }, snapshot])
]);
const ccffDecimals = Number(decode(erc20Abi, "decimals", ccffDecimalsRaw));
const rmtDecimals = Number(decode(erc20Abi, "decimals", rmtDecimalsRaw));
const expectedCcff = decode(nftAbi, "TOKENS_PER_NFT", expectedCcffRaw);

const tbaResults = await batches(ids, (id) => ({ method: "eth_call", params: [{ to: NFT, data: encode(nftAbi, "getTokenBoundAccount", [BigInt(id)]) }, snapshot] }));
const ownerResults = await batches(ids, (id) => ({ method: "eth_call", params: [{ to: NFT, data: encode(nftAbi, "ownerOf", [BigInt(id)]) }, snapshot] }));
const base = ids.map((tokenId, index) => {
  if (tbaResults[index].error || ownerResults[index].error) throw new Error(`#${tokenId} identity read failed`);
  return {
    tokenId,
    owner: getAddress(decode(nftAbi, "ownerOf", ownerResults[index].result)),
    tba: getAddress(decode(nftAbi, "getTokenBoundAccount", tbaResults[index].result))
  };
});
if (new Set(base.map((row) => row.tba.toLowerCase())).size !== PUBLIC_MINTED) throw new Error("public TBA addresses are not unique");

const codeResults = await batches(base, (row) => ({ method: "eth_getCode", params: [row.tba, snapshot] }));
const ccffResults = await batches(base, (row) => ({ method: "eth_call", params: [{ to: CCFF00, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshot] }));
const rmtResults = await batches(base, (row) => ({ method: "eth_call", params: [{ to: RMT, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshot] }));

const rows = base.map((row, index) => {
  if (codeResults[index].error || ccffResults[index].error || rmtResults[index].error) throw new Error(`#${row.tokenId} balance/code read failed`);
  const ccffRaw = decode(erc20Abi, "balanceOf", ccffResults[index].result);
  const rmtRaw = decode(erc20Abi, "balanceOf", rmtResults[index].result);
  return {
    ...row,
    activated: codeResults[index].result !== "0x",
    codeBytes: Math.max(0, (codeResults[index].result.length - 2) / 2),
    ccff00BalanceRaw: ccffRaw.toString(),
    ccff00Balance: formatUnits(ccffRaw, ccffDecimals),
    exactConfiguredCcff00: ccffRaw === expectedCcff,
    rmtBalanceRaw: rmtRaw.toString(),
    rmtBalance: formatUnits(rmtRaw, rmtDecimals)
  };
});

const positiveRmt = rows.filter((row) => BigInt(row.rmtBalanceRaw) > 0n);
const activated = rows.filter((row) => row.activated);
const wrongCcff = rows.filter((row) => !row.exactConfiguredCcff00);
const uniqueOwners = new Set(rows.map((row) => row.owner.toLowerCase()));
const totalExistingRmt = rows.reduce((sum, row) => sum + BigInt(row.rmtBalanceRaw), 0n);
const totalCcff = rows.reduce((sum, row) => sum + BigInt(row.ccff00BalanceRaw), 0n);
const summary = {
  snapshotBlock: snapshotBlock.toString(),
  publicNfts: rows.length,
  uniquePublicOwners: uniqueOwners.size,
  uniquePublicTbas: new Set(rows.map((row) => row.tba.toLowerCase())).size,
  activatedPublicTbas: activated.length,
  counterfactualPublicTbas: rows.length - activated.length,
  publicTbasWithExact10000Ccff00: rows.length - wrongCcff.length,
  publicTbasWithDifferentCcff00Balance: wrongCcff.length,
  totalCcff00AcrossPublicTbas: formatUnits(totalCcff, ccffDecimals),
  publicTbasAlreadyHoldingRmt: positiveRmt.length,
  publicTbasWithZeroRmt: rows.length - positiveRmt.length,
  totalExistingRmtAcrossPublicTbas: formatUnits(totalExistingRmt, rmtDecimals),
  budgets: {
    rmt100Each: "48200",
    rmt250Each: "120500",
    rmt500Each: "241000",
    rmt1000Each: "482000",
    rmt2000Each: "964000"
  },
  canaries: rows.filter((row) => ["470", "471", "472"].includes(row.tokenId))
};
console.log("PUBLIC_DROP_SUMMARY", JSON.stringify(summary, null, 2));
await mkdir("tmp", { recursive: true });
await writeFile("tmp/ccff00-public-tba-audit.json", JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), summary, recipients: rows }, null, 2));
await writeFile("tmp/ccff00-public-tba-audit.csv", [
  "tokenId,owner,tba,activated,ccff00Balance,rmtBalance",
  ...rows.map((row) => `${row.tokenId},${row.owner},${row.tba},${row.activated},${row.ccff00Balance},${row.rmtBalance}`)
].join("\n"));
console.log("PUBLIC_AUDIT_COMPLETE — no signing, approvals, transactions, deployments, environment changes, or production writes.");
