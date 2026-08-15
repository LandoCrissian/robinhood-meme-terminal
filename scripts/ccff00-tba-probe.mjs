import { mkdir, writeFile } from "node:fs/promises";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi
} from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const HOODSTREET = "https://hoodstreet.capital/ccff00";
const CHAIN_ID = 4663;
const NFT = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const CCFF00 = getAddress("0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97");
const RMT = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const EXPECTED_REGISTRY = getAddress("0x000000006551c19487814612e58FE06813775758");
const EXPECTED_IMPLEMENTATION = getAddress("0x03dA8C9df253a4401b08629a6F50E4c4E8e248cC");
const EXPECTED_SALT = "0x448cc5ed5a52db42393a3d48476af932464724d8262648ad18b66d2ffef1a8e0";
const DEPLOYMENT_BLOCK = 10_929_152n;
const HOOD_AIRDROP = getAddress("0x7bd896c76351250aCC46AA7DcB22C0106dbb1175");
const BATCH_SIZE = 80;

const nftAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getTokenBoundAccount(uint256 tokenId) view returns (address)",
  "function erc6551Registry() view returns (address)",
  "function erc6551Implementation() view returns (address)",
  "function erc6551Salt() view returns (bytes32)",
  "function accountChainId() view returns (uint256)",
  "function ccff00Token() view returns (address)",
  "function TOKENS_PER_NFT() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function PUBLIC_SUPPLY() view returns (uint256)",
  "function PUBLIC_START_ID() view returns (uint256)",
  "function FOUNDER_START_ID() view returns (uint256)",
  "function PROJECT_START_ID() view returns (uint256)",
  "function FOUNDER_RESERVE() view returns (uint256)",
  "function PROJECT_RESERVE() view returns (uint256)",
  "function TOTAL_RESERVE() view returns (uint256)",
  "function publicMinted() view returns (uint256)",
  "function reserveMinted() view returns (uint256)"
]);
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}, attempts = 4) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (response.ok) return { response, text };
      last = new Error(`${url} HTTP ${response.status}: ${text.slice(0, 300)}`);
    } catch (error) {
      last = error;
    }
    await sleep(attempt * 350);
  }
  throw last;
}

async function json(url) {
  const { text } = await fetchText(url, { headers: { accept: "application/json" } });
  return JSON.parse(text);
}

async function rpcBatch(calls) {
  const payload = calls.map((call, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: call.method,
    params: call.params
  }));
  const { text } = await fetchText(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = JSON.parse(text);
  if (!Array.isArray(response)) throw new Error("RPC batch returned a non-array response.");
  const byId = new Map(response.map((entry) => [entry.id, entry]));
  return calls.map((_, index) => {
    const entry = byId.get(index + 1);
    if (!entry) throw new Error(`RPC batch omitted result ${index + 1}.`);
    if (entry.error) return { error: entry.error.message ?? JSON.stringify(entry.error) };
    return { result: entry.result };
  });
}

async function rpc(method, params) {
  const [entry] = await rpcBatch([{ method, params }]);
  if (entry.error) throw new Error(`${method}: ${entry.error}`);
  return entry.result;
}

async function batchMap(items, makeCall) {
  const output = [];
  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    const chunk = items.slice(offset, offset + BATCH_SIZE);
    const results = await rpcBatch(chunk.map(makeCall));
    output.push(...results);
  }
  return output;
}

function blockTag(blockNumber) {
  return `0x${blockNumber.toString(16)}`;
}

function encode(abi, functionName, args = []) {
  return encodeFunctionData({ abi, functionName, args });
}

function decode(abi, functionName, data) {
  return decodeFunctionResult({ abi, functionName, data });
}

async function readAt(address, abi, functionName, args, block) {
  const raw = await rpc("eth_call", [{ to: address, data: encode(abi, functionName, args) }, blockTag(block)]);
  return decode(abi, functionName, raw);
}

function contractSummary(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries([
    "hash", "name", "is_contract", "is_verified", "compiler_version", "optimization_enabled",
    "proxy_type", "is_proxy", "implementation_address", "implementations", "creator_address_hash",
    "creation_tx_hash", "constructor_args"
  ].filter((key) => key in value).map((key) => [key, value[key]]));
}

function abiNames(abi, type) {
  return Array.isArray(abi)
    ? abi.filter((item) => item?.type === type && typeof item.name === "string").map((item) => item.name).sort()
    : [];
}

function sourceContext(source, needle, width = 650) {
  if (typeof source !== "string") return null;
  const index = source.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return source.slice(Math.max(0, index - width), Math.min(source.length, index + needle.length + width)).replace(/\s+/g, " ");
}

async function inspectContract(address, label, block) {
  const [code, info, smart] = await Promise.all([
    rpc("eth_getCode", [address, blockTag(block)]),
    json(`${BLOCKSCOUT}/api/v2/addresses/${address}`),
    json(`${BLOCKSCOUT}/api/v2/smart-contracts/${address}`)
  ]);
  const output = {
    label,
    address,
    codeBytes: Math.max(0, (code.length - 2) / 2),
    addressInfo: contractSummary(info),
    smartContract: contractSummary(smart),
    abiFunctions: abiNames(smart.abi, "function"),
    abiEvents: abiNames(smart.abi, "event"),
    getTokenBoundAccountSource: sourceContext(smart.source_code, "getTokenBoundAccount"),
    tokenBoundAccountFundedSource: sourceContext(smart.source_code, "TokenBoundAccountFunded")
  };
  console.log("CONTRACT", JSON.stringify(output, null, 2));
  return output;
}

async function fetchAllInstances() {
  const items = [];
  let next = null;
  let pages = 0;
  do {
    const url = new URL(`${BLOCKSCOUT}/api/v2/tokens/${NFT}/instances`);
    if (next && typeof next === "object") {
      for (const [key, value] of Object.entries(next)) {
        if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const payload = await json(url.toString());
    if (!Array.isArray(payload.items)) throw new Error("Blockscout NFT instances response omitted items.");
    items.push(...payload.items);
    next = payload.next_page_params ?? null;
    pages += 1;
    if (pages > 100) throw new Error("Blockscout NFT instance pagination exceeded safety limit.");
  } while (next);
  const ids = [...new Set(items.map((item) => {
    const value = item?.id ?? item?.token_id;
    if (typeof value !== "string" && typeof value !== "number") return null;
    try { return BigInt(value).toString(); } catch { return null; }
  }).filter(Boolean))].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
  return { pages, rawCount: items.length, ids };
}

function requireEqual(label, actual, expected) {
  const left = typeof actual === "string" ? actual.toLowerCase() : actual;
  const right = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (left !== right) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
}

const snapshotBlock = BigInt(await rpc("eth_blockNumber", []));
const snapshotTag = blockTag(snapshotBlock);
console.log("CCFF00 FULL READ-ONLY SNAPSHOT");
console.log("snapshotBlock", snapshotBlock.toString());
console.log("snapshotTag", snapshotTag);

const [
  totalSupply,
  registry,
  implementation,
  salt,
  accountChainId,
  ccff00Token,
  tokensPerNft,
  maxSupply,
  publicSupply,
  publicStartId,
  founderStartId,
  projectStartId,
  founderReserve,
  projectReserve,
  totalReserve,
  publicMinted,
  reserveMinted,
  ccff00Decimals,
  rmtDecimals
] = await Promise.all([
  readAt(NFT, nftAbi, "totalSupply", [], snapshotBlock),
  readAt(NFT, nftAbi, "erc6551Registry", [], snapshotBlock),
  readAt(NFT, nftAbi, "erc6551Implementation", [], snapshotBlock),
  readAt(NFT, nftAbi, "erc6551Salt", [], snapshotBlock),
  readAt(NFT, nftAbi, "accountChainId", [], snapshotBlock),
  readAt(NFT, nftAbi, "ccff00Token", [], snapshotBlock),
  readAt(NFT, nftAbi, "TOKENS_PER_NFT", [], snapshotBlock),
  readAt(NFT, nftAbi, "MAX_SUPPLY", [], snapshotBlock),
  readAt(NFT, nftAbi, "PUBLIC_SUPPLY", [], snapshotBlock),
  readAt(NFT, nftAbi, "PUBLIC_START_ID", [], snapshotBlock),
  readAt(NFT, nftAbi, "FOUNDER_START_ID", [], snapshotBlock),
  readAt(NFT, nftAbi, "PROJECT_START_ID", [], snapshotBlock),
  readAt(NFT, nftAbi, "FOUNDER_RESERVE", [], snapshotBlock),
  readAt(NFT, nftAbi, "PROJECT_RESERVE", [], snapshotBlock),
  readAt(NFT, nftAbi, "TOTAL_RESERVE", [], snapshotBlock),
  readAt(NFT, nftAbi, "publicMinted", [], snapshotBlock),
  readAt(NFT, nftAbi, "reserveMinted", [], snapshotBlock),
  readAt(CCFF00, erc20Abi, "decimals", [], snapshotBlock),
  readAt(RMT, erc20Abi, "decimals", [], snapshotBlock)
]);

requireEqual("ERC-6551 registry", getAddress(registry), EXPECTED_REGISTRY);
requireEqual("ERC-6551 implementation", getAddress(implementation), EXPECTED_IMPLEMENTATION);
requireEqual("ERC-6551 salt", salt, EXPECTED_SALT);
requireEqual("ERC-6551 account chain", Number(accountChainId), CHAIN_ID);
requireEqual("CCFF00 token binding", getAddress(ccff00Token), CCFF00);

const configuration = {
  nft: NFT,
  ccff00Token: CCFF00,
  rmtToken: RMT,
  snapshotBlock: snapshotBlock.toString(),
  deploymentBlock: DEPLOYMENT_BLOCK.toString(),
  totalSupply: totalSupply.toString(),
  registry: getAddress(registry),
  implementation: getAddress(implementation),
  salt,
  accountChainId: Number(accountChainId),
  tokensPerNftRaw: tokensPerNft.toString(),
  tokensPerNft: formatUnits(tokensPerNft, Number(ccff00Decimals)),
  maxSupply: maxSupply.toString(),
  publicSupply: publicSupply.toString(),
  publicStartId: publicStartId.toString(),
  founderStartId: founderStartId.toString(),
  projectStartId: projectStartId.toString(),
  founderReserve: founderReserve.toString(),
  projectReserve: projectReserve.toString(),
  totalReserve: totalReserve.toString(),
  publicMinted: publicMinted.toString(),
  reserveMinted: reserveMinted.toString(),
  ccff00Decimals: Number(ccff00Decimals),
  rmtDecimals: Number(rmtDecimals)
};
console.log("CONFIGURATION", JSON.stringify(configuration, null, 2));

const [nftContract, implementationContract, registryContract, airdropContract] = await Promise.all([
  inspectContract(NFT, "CCFF00 ERC-721", snapshotBlock),
  inspectContract(EXPECTED_IMPLEMENTATION, "CCFF00 ERC-6551 implementation", snapshotBlock),
  inspectContract(EXPECTED_REGISTRY, "ERC-6551 registry", snapshotBlock),
  inspectContract(HOOD_AIRDROP, "candidate HoodAirdrop batch sender", snapshotBlock)
]);
if (implementationContract.codeBytes === 0) throw new Error("CCFF00 account implementation has no runtime bytecode.");
if (registryContract.codeBytes === 0) throw new Error("ERC-6551 registry has no runtime bytecode.");

const instanceResult = await fetchAllInstances();
console.log("INSTANCE_ENUMERATION", JSON.stringify(instanceResult, null, 2));
if (BigInt(instanceResult.ids.length) !== totalSupply) {
  throw new Error(`NFT instance count ${instanceResult.ids.length} does not match totalSupply ${totalSupply}.`);
}

const tokenIds = instanceResult.ids;
const ownerCalls = await batchMap(tokenIds, (id) => ({
  method: "eth_call",
  params: [{ to: NFT, data: encode(nftAbi, "ownerOf", [BigInt(id)]) }, snapshotTag]
}));
const tbaCalls = await batchMap(tokenIds, (id) => ({
  method: "eth_call",
  params: [{ to: NFT, data: encode(nftAbi, "getTokenBoundAccount", [BigInt(id)]) }, snapshotTag]
}));

const preliminary = tokenIds.map((tokenId, index) => {
  const ownerResult = ownerCalls[index];
  const tbaResult = tbaCalls[index];
  if (ownerResult.error) throw new Error(`ownerOf(${tokenId}) failed: ${ownerResult.error}`);
  if (tbaResult.error) throw new Error(`getTokenBoundAccount(${tokenId}) failed: ${tbaResult.error}`);
  return {
    tokenId,
    owner: getAddress(decode(nftAbi, "ownerOf", ownerResult.result)),
    tba: getAddress(decode(nftAbi, "getTokenBoundAccount", tbaResult.result))
  };
});

if (new Set(preliminary.map((row) => row.tba.toLowerCase())).size !== preliminary.length) {
  throw new Error("CCFF00 token-bound account resolution produced duplicate TBA addresses.");
}

const codeCalls = await batchMap(preliminary, (row) => ({
  method: "eth_getCode",
  params: [row.tba, snapshotTag]
}));
const ccff00BalanceCalls = await batchMap(preliminary, (row) => ({
  method: "eth_call",
  params: [{ to: CCFF00, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshotTag]
}));
const rmtBalanceCalls = await batchMap(preliminary, (row) => ({
  method: "eth_call",
  params: [{ to: RMT, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshotTag]
}));

const rows = preliminary.map((row, index) => {
  const code = codeCalls[index];
  const ccff = ccff00BalanceCalls[index];
  const rmt = rmtBalanceCalls[index];
  if (code.error) throw new Error(`eth_getCode(${row.tba}) failed: ${code.error}`);
  if (ccff.error) throw new Error(`CCFF00 balanceOf(${row.tba}) failed: ${ccff.error}`);
  if (rmt.error) throw new Error(`RMT balanceOf(${row.tba}) failed: ${rmt.error}`);
  const ccff00BalanceRaw = decode(erc20Abi, "balanceOf", ccff.result);
  const rmtBalanceRaw = decode(erc20Abi, "balanceOf", rmt.result);
  return {
    ...row,
    tbaActivated: code.result !== "0x",
    tbaCodeBytes: Math.max(0, (code.result.length - 2) / 2),
    ccff00BalanceRaw: ccff00BalanceRaw.toString(),
    ccff00Balance: formatUnits(ccff00BalanceRaw, Number(ccff00Decimals)),
    rmtBalanceRaw: rmtBalanceRaw.toString(),
    rmtBalance: formatUnits(rmtBalanceRaw, Number(rmtDecimals))
  };
});

const byToken = new Map(rows.map((row) => [row.tokenId, row]));
const canaries = ["470", "471", "472"].map((id) => {
  const row = byToken.get(id);
  if (!row) throw new Error(`Canary token ${id} was not found in the minted instance set.`);
  return row;
});
const screenshotChecks = [
  { id: "470", prefix: "0xfd1f", suffix: "0a6e" },
  { id: "471", prefix: "0xf26b", suffix: "6246" },
  { id: "472", prefix: "0x3b71", suffix: "83d5" }
];
for (const expected of screenshotChecks) {
  const tba = byToken.get(expected.id).tba.toLowerCase();
  if (!tba.startsWith(expected.prefix) || !tba.endsWith(expected.suffix)) {
    throw new Error(`Token #${expected.id} TBA ${tba} does not match HoodStreet screenshot ${expected.prefix}…${expected.suffix}.`);
  }
}
console.log("CANARY_TBAS", JSON.stringify(canaries, null, 2));

const uniqueOwners = new Set(rows.map((row) => row.owner.toLowerCase()));
const activated = rows.filter((row) => row.tbaActivated);
const fundedAsDesigned = rows.filter((row) => BigInt(row.ccff00BalanceRaw) === tokensPerNft);
const existingRmt = rows.filter((row) => BigInt(row.rmtBalanceRaw) > 0n);
const totalCcff00Raw = rows.reduce((sum, row) => sum + BigInt(row.ccff00BalanceRaw), 0n);
const totalRmtBeforeRaw = rows.reduce((sum, row) => sum + BigInt(row.rmtBalanceRaw), 0n);
const recipientCount = rows.length;
const budgets = Object.fromEntries([1, 100, 250, 500, 1000, 1250, 1366].map((amount) => [
  `${amount}RmtPerNft`,
  {
    perNft: amount,
    totalRmt: (BigInt(amount) * BigInt(recipientCount)).toString()
  }
]));

const summary = {
  snapshotBlock: snapshotBlock.toString(),
  nftSupply: totalSupply.toString(),
  enumeratedNfts: rows.length,
  uniqueOwnerWallets: uniqueOwners.size,
  uniqueTbas: new Set(rows.map((row) => row.tba.toLowerCase())).size,
  activatedTbas: activated.length,
  counterfactualTbas: rows.length - activated.length,
  tbasHoldingExactConfiguredCcff00Amount: fundedAsDesigned.length,
  totalCcff00AcrossTbasRaw: totalCcff00Raw.toString(),
  totalCcff00AcrossTbas: formatUnits(totalCcff00Raw, Number(ccff00Decimals)),
  tbasAlreadyHoldingRmt: existingRmt.length,
  totalRmtAcrossTbasBeforeRaw: totalRmtBeforeRaw.toString(),
  totalRmtAcrossTbasBefore: formatUnits(totalRmtBeforeRaw, Number(rmtDecimals)),
  canaries,
  budgets,
  batchSenderCandidate: {
    address: HOOD_AIRDROP,
    deployed: airdropContract.codeBytes > 0,
    verified: airdropContract.smartContract?.is_verified === true,
    contractName: airdropContract.smartContract?.name ?? null,
    functions: airdropContract.abiFunctions
  }
};
console.log("SUMMARY", JSON.stringify(summary, null, 2));

await mkdir("tmp", { recursive: true });
await writeFile("tmp/ccff00-tba-snapshot.json", JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  configuration,
  summary,
  contracts: {
    nft: nftContract,
    implementation: implementationContract,
    registry: registryContract,
    batchSenderCandidate: airdropContract
  },
  recipients: rows
}, null, 2));
const csv = [
  "tokenId,owner,tba,tbaActivated,tbaCodeBytes,ccff00BalanceRaw,ccff00Balance,rmtBalanceRaw,rmtBalance",
  ...rows.map((row) => [
    row.tokenId,
    row.owner,
    row.tba,
    row.tbaActivated,
    row.tbaCodeBytes,
    row.ccff00BalanceRaw,
    row.ccff00Balance,
    row.rmtBalanceRaw,
    row.rmtBalance
  ].join(","))
].join("\n");
await writeFile("tmp/ccff00-tba-snapshot.csv", csv);
await writeFile("tmp/ccff00-tba-summary.json", JSON.stringify(summary, null, 2));

console.log("OUTPUT_FILES tmp/ccff00-tba-snapshot.json tmp/ccff00-tba-snapshot.csv tmp/ccff00-tba-summary.json");
console.log("PROBE COMPLETE — no signing, approvals, transactions, deployments, environment changes, or production writes performed.");
