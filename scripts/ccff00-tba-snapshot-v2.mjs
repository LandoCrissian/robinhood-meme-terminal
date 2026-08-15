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
const NFT = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const CCFF00 = getAddress("0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97");
const RMT = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
const REGISTRY = getAddress("0x000000006551c19487814612e58FE06813775758");
const IMPLEMENTATION = getAddress("0x03dA8C9df253a4401b08629a6F50E4c4E8e248cC");
const SALT = "0x448cc5ed5a52db42393a3d48476af932464724d8262648ad18b66d2ffef1a8e0";
const CHAIN_ID = 4663;
const HOOD_AIRDROP = getAddress("0x7bd896c76351250aCC46AA7DcB22C0106dbb1175");
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 700;

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
  "function publicMinted() view returns (uint256)",
  "function reserveMinted() view returns (uint256)"
]);
const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blockTag = (number) => `0x${number.toString(16)}`;
const encode = (abi, functionName, args = []) => encodeFunctionData({ abi, functionName, args });
const decode = (abi, functionName, data) => decodeFunctionResult({ abi, functionName, data });

async function fetchWithRetry(url, options = {}, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (response.ok) return { response, text };
      lastError = new Error(`${url} HTTP ${response.status}: ${text.slice(0, 300)}`);
      if (response.status === 429) await sleep(Math.min(12_000, 1_500 * attempt));
      else await sleep(Math.min(4_000, 400 * attempt));
    } catch (error) {
      lastError = error;
      await sleep(Math.min(4_000, 400 * attempt));
    }
  }
  throw lastError;
}

async function rpcBatch(calls) {
  const payload = calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params }));
  const { text } = await fetchWithRetry(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = JSON.parse(text);
  if (!Array.isArray(response)) throw new Error("RPC returned a non-array batch response.");
  const byId = new Map(response.map((entry) => [entry.id, entry]));
  return calls.map((_, index) => {
    const entry = byId.get(index + 1);
    if (!entry) throw new Error(`RPC omitted batch entry ${index + 1}.`);
    return entry.error ? { error: entry.error.message ?? JSON.stringify(entry.error) } : { result: entry.result };
  });
}

async function rpc(method, params) {
  const [entry] = await rpcBatch([{ method, params }]);
  if (entry.error) throw new Error(`${method}: ${entry.error}`);
  return entry.result;
}

async function throttledBatch(items, makeCall) {
  const output = [];
  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    const chunk = items.slice(offset, offset + BATCH_SIZE);
    output.push(...await rpcBatch(chunk.map(makeCall)));
    if (offset + BATCH_SIZE < items.length) await sleep(BATCH_PAUSE_MS);
  }
  return output;
}

async function read(address, abi, functionName, args, block) {
  const raw = await rpc("eth_call", [{ to: address, data: encode(abi, functionName, args) }, blockTag(block)]);
  return decode(abi, functionName, raw);
}

async function getJson(url) {
  const { text } = await fetchWithRetry(url, { headers: { accept: "application/json" } });
  return JSON.parse(text);
}

async function allInstances() {
  const raw = [];
  let next = null;
  let pages = 0;
  do {
    const url = new URL(`${BLOCKSCOUT}/api/v2/tokens/${NFT}/instances`);
    for (const [key, value] of Object.entries(next ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const page = await getJson(url.toString());
    if (!Array.isArray(page.items)) throw new Error("Blockscout instances response is malformed.");
    raw.push(...page.items);
    next = page.next_page_params ?? null;
    pages += 1;
    if (pages > 100) throw new Error("Instance pagination exceeded safety limit.");
  } while (next);
  const records = raw.map((item) => {
    const id = BigInt(item.id ?? item.token_id).toString();
    const ownerValue = item.owner?.hash ?? item.owner?.address_hash ?? item.owner_hash ?? null;
    return {
      tokenId: id,
      blockscoutOwner: typeof ownerValue === "string" ? getAddress(ownerValue) : null
    };
  }).sort((a, b) => BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : BigInt(a.tokenId) > BigInt(b.tokenId) ? 1 : 0);
  return { pages, records };
}

function exact(label, actual, expected) {
  const a = typeof actual === "string" ? actual.toLowerCase() : actual;
  const e = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (a !== e) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
}

const snapshotBlock = BigInt(await rpc("eth_blockNumber", []));
const snapshot = blockTag(snapshotBlock);
console.log("SNAPSHOT_BLOCK", snapshotBlock.toString());

const [supply, registry, implementation, salt, chainId, ccff00Token, tokensPerNft, publicMinted, reserveMinted, ccffDecimals, rmtDecimals] = await Promise.all([
  read(NFT, nftAbi, "totalSupply", [], snapshotBlock),
  read(NFT, nftAbi, "erc6551Registry", [], snapshotBlock),
  read(NFT, nftAbi, "erc6551Implementation", [], snapshotBlock),
  read(NFT, nftAbi, "erc6551Salt", [], snapshotBlock),
  read(NFT, nftAbi, "accountChainId", [], snapshotBlock),
  read(NFT, nftAbi, "ccff00Token", [], snapshotBlock),
  read(NFT, nftAbi, "TOKENS_PER_NFT", [], snapshotBlock),
  read(NFT, nftAbi, "publicMinted", [], snapshotBlock),
  read(NFT, nftAbi, "reserveMinted", [], snapshotBlock),
  read(CCFF00, erc20Abi, "decimals", [], snapshotBlock),
  read(RMT, erc20Abi, "decimals", [], snapshotBlock)
]);
exact("registry", getAddress(registry), REGISTRY);
exact("implementation", getAddress(implementation), IMPLEMENTATION);
exact("salt", salt, SALT);
exact("accountChainId", Number(chainId), CHAIN_ID);
exact("ccff00Token", getAddress(ccff00Token), CCFF00);

const instances = await allInstances();
if (BigInt(instances.records.length) !== supply) throw new Error(`Blockscout enumerated ${instances.records.length}, supply is ${supply}.`);
console.log("MINT_COUNTS", JSON.stringify({ totalSupply: supply.toString(), publicMinted: publicMinted.toString(), reserveMinted: reserveMinted.toString(), instancePages: instances.pages }));
console.log("MINT_RANGES", JSON.stringify({ public: "1-482", founder: "9751-9770", project: "9771-10000", exactEnumeratedCount: instances.records.length }));

const tbaResults = await throttledBatch(instances.records, (row) => ({
  method: "eth_call",
  params: [{ to: NFT, data: encode(nftAbi, "getTokenBoundAccount", [BigInt(row.tokenId)]) }, snapshot]
}));
const recipients = instances.records.map((row, index) => {
  const result = tbaResults[index];
  if (result.error) throw new Error(`getTokenBoundAccount(${row.tokenId}) failed: ${result.error}`);
  return { ...row, tba: getAddress(decode(nftAbi, "getTokenBoundAccount", result.result)) };
});
if (new Set(recipients.map((row) => row.tba.toLowerCase())).size !== recipients.length) throw new Error("Duplicate TBA address detected.");

const canaries = ["470", "471", "472"].map((tokenId) => {
  const row = recipients.find((candidate) => candidate.tokenId === tokenId);
  if (!row) throw new Error(`Canary #${tokenId} missing.`);
  return row;
});
const expectedUi = {
  "470": { prefix: "0xfd1f", suffix: "0a6e" },
  "471": { prefix: "0xf26b", suffix: "6246" },
  "472": { prefix: "0x3b71", suffix: "83d5" }
};
for (const row of canaries) {
  const tba = row.tba.toLowerCase();
  const expected = expectedUi[row.tokenId];
  if (!tba.startsWith(expected.prefix) || !tba.endsWith(expected.suffix)) throw new Error(`#${row.tokenId} TBA ${row.tba} does not match HoodStreet UI ${expected.prefix}…${expected.suffix}.`);
}

const canaryOwnerResults = await throttledBatch(canaries, (row) => ({
  method: "eth_call",
  params: [{ to: NFT, data: encode(nftAbi, "ownerOf", [BigInt(row.tokenId)]) }, snapshot]
}));
const canaryCodeResults = await throttledBatch(canaries, (row) => ({ method: "eth_getCode", params: [row.tba, snapshot] }));
const canaryCcffResults = await throttledBatch(canaries, (row) => ({
  method: "eth_call",
  params: [{ to: CCFF00, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshot]
}));
const canaryRmtResults = await throttledBatch(canaries, (row) => ({
  method: "eth_call",
  params: [{ to: RMT, data: encode(erc20Abi, "balanceOf", [row.tba]) }, snapshot]
}));

const canaryDetails = canaries.map((row, index) => {
  for (const result of [canaryOwnerResults[index], canaryCodeResults[index], canaryCcffResults[index], canaryRmtResults[index]]) {
    if (result.error) throw new Error(`Canary #${row.tokenId} probe failed: ${result.error}`);
  }
  const ccffRaw = decode(erc20Abi, "balanceOf", canaryCcffResults[index].result);
  const rmtRaw = decode(erc20Abi, "balanceOf", canaryRmtResults[index].result);
  return {
    tokenId: row.tokenId,
    owner: getAddress(decode(nftAbi, "ownerOf", canaryOwnerResults[index].result)),
    tba: row.tba,
    activated: canaryCodeResults[index].result !== "0x",
    codeBytes: Math.max(0, (canaryCodeResults[index].result.length - 2) / 2),
    ccff00BalanceRaw: ccffRaw.toString(),
    ccff00Balance: formatUnits(ccffRaw, Number(ccffDecimals)),
    rmtBalanceRaw: rmtRaw.toString(),
    rmtBalance: formatUnits(rmtRaw, Number(rmtDecimals))
  };
});
console.log("CANARIES", JSON.stringify(canaryDetails, null, 2));

const holderInfo = await getJson(`${BLOCKSCOUT}/api/v2/tokens/${NFT}`);
const blockscoutOwners = recipients.map((row) => row.blockscoutOwner).filter(Boolean);
const uniqueOwnersFromInstances = new Set(blockscoutOwners.map((owner) => owner.toLowerCase())).size;

const [implementationCode, airdropCode, airdropSmart] = await Promise.all([
  rpc("eth_getCode", [IMPLEMENTATION, snapshot]),
  rpc("eth_getCode", [HOOD_AIRDROP, snapshot]),
  getJson(`${BLOCKSCOUT}/api/v2/smart-contracts/${HOOD_AIRDROP}`)
]);
const airdropFunctions = Array.isArray(airdropSmart.abi) ? airdropSmart.abi.filter((item) => item?.type === "function").map((item) => item.name).sort() : [];
const source = typeof airdropSmart.source_code === "string" ? airdropSmart.source_code : "";
const equalIndex = source.indexOf("airdropEqual");
const airdropEqualSource = equalIndex >= 0 ? source.slice(Math.max(0, equalIndex - 500), equalIndex + 1800).replace(/\s+/g, " ") : null;

const budgets = Object.fromEntries([1, 100, 250, 500, 1000, 1250, 1366].map((perNft) => [
  `${perNft}RmtPerNft`,
  { perNft, totalRmt: (BigInt(perNft) * supply).toString() }
]));
const summary = {
  snapshotBlock: snapshotBlock.toString(),
  nft: NFT,
  ccff00Token: CCFF00,
  rmtToken: RMT,
  supply: supply.toString(),
  publicMinted: publicMinted.toString(),
  reserveMinted: reserveMinted.toString(),
  registry: getAddress(registry),
  implementation: getAddress(implementation),
  implementationCodeBytes: Math.max(0, (implementationCode.length - 2) / 2),
  implementationSourceVerifiedOnBlockscout: false,
  salt,
  accountChainId: Number(chainId),
  tokensPerNft: formatUnits(tokensPerNft, Number(ccffDecimals)),
  uniqueTbas: new Set(recipients.map((row) => row.tba.toLowerCase())).size,
  blockscoutHolderCount: Number(holderInfo.holders_count ?? 0),
  uniqueOwnersVisibleInInstanceApi: uniqueOwnersFromInstances,
  instanceOwnerCoverage: blockscoutOwners.length,
  canaries: canaryDetails,
  budgets,
  hoodAirdrop: {
    address: HOOD_AIRDROP,
    codeBytes: Math.max(0, (airdropCode.length - 2) / 2),
    verified: airdropSmart.is_verified === true,
    name: airdropSmart.name ?? null,
    functions: airdropFunctions,
    airdropEqualSource
  }
};
console.log("SUMMARY", JSON.stringify(summary, null, 2));

await mkdir("tmp", { recursive: true });
await writeFile("tmp/ccff00-tba-summary.json", JSON.stringify(summary, null, 2));
await writeFile("tmp/ccff00-tba-snapshot.json", JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), summary, recipients }, null, 2));
await writeFile("tmp/ccff00-tba-snapshot.csv", [
  "tokenId,ownerFromBlockscout,tba",
  ...recipients.map((row) => `${row.tokenId},${row.blockscoutOwner ?? ""},${row.tba}`)
].join("\n"));
console.log("OUTPUT_READY", recipients.length, "recipients");
console.log("READ_ONLY_COMPLETE — no signing, approvals, transactions, deployments, environment changes, or production writes.");
