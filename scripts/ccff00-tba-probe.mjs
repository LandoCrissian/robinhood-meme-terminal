const RPC = "https://rpc.mainnet.chain.robinhood.com";
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const HOODSTREET = "https://hoodstreet.capital/ccff00";
const CHAIN_ID = 4663;
const candidates = [
  "0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146",
  "0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97"
];
const registry = "0x000000006551c19487814612e58FE06813775758";
const tokenboundProxy = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";
const tokenboundImplementation = "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC";

function pad64(hex) {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

function encodeUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeAddress(raw) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) return null;
  return `0x${raw.slice(-40)}`;
}

function decodeUint(raw) {
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  try { return BigInt(raw).toString(); } catch { return null; }
}

function decodeAbiString(raw) {
  if (!raw || raw === "0x") return null;
  const hex = raw.slice(2);
  try {
    // Dynamic ABI string.
    if (hex.length >= 128) {
      const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
      const lengthPos = offset * 2;
      if (hex.length >= lengthPos + 64) {
        const length = Number(BigInt(`0x${hex.slice(lengthPos, lengthPos + 64)}`));
        const dataStart = lengthPos + 64;
        const data = hex.slice(dataStart, dataStart + length * 2);
        return Buffer.from(data, "hex").toString("utf8").replace(/\0/g, "");
      }
    }
    // bytes32-style fallback.
    if (hex.length >= 64) return Buffer.from(hex.slice(0, 64), "hex").toString("utf8").replace(/\0/g, "");
  } catch {}
  return null;
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

async function ethCall(to, data) {
  try {
    return await rpc("eth_call", [{ to, data }, "latest"]);
  } catch (error) {
    return `ERROR:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function json(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) return { status: response.status, error: text.slice(0, 500) };
    return JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function pick(object, keys) {
  if (!object || typeof object !== "object") return object;
  return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));
}

function functionNames(abi) {
  if (!Array.isArray(abi)) return [];
  return abi.filter((item) => item && item.type === "function" && typeof item.name === "string").map((item) => item.name).sort();
}

function eventNames(abi) {
  if (!Array.isArray(abi)) return [];
  return abi.filter((item) => item && item.type === "event" && typeof item.name === "string").map((item) => item.name).sort();
}

function addresses(text) {
  return [...new Set((text.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((value) => value.toLowerCase()))].sort();
}

function context(text, needle, width = 260) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return text.slice(Math.max(0, index - width), Math.min(text.length, index + needle.length + width)).replace(/\s+/g, " ");
}

console.log("CCFF00 READ-ONLY PROBE");
console.log(JSON.stringify({ chainId: CHAIN_ID, candidates, registry, tokenboundProxy, tokenboundImplementation }, null, 2));
console.log("latestBlock", await rpc("eth_blockNumber", []).then((value) => BigInt(value).toString()));

for (const address of [...candidates, registry, tokenboundProxy, tokenboundImplementation]) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  console.log("\nADDRESS", address, "codeBytes", Math.max(0, (code.length - 2) / 2));
  const info = await json(`${BLOCKSCOUT}/api/v2/addresses/${address}`);
  console.log("addressInfo", JSON.stringify(pick(info, [
    "hash", "name", "is_contract", "is_verified", "proxy_type", "implementations",
    "creation_tx_hash", "creator_address_hash", "token"
  ]), null, 2));
  const token = await json(`${BLOCKSCOUT}/api/v2/tokens/${address}`);
  console.log("tokenInfo", JSON.stringify(pick(token, [
    "address_hash", "name", "symbol", "type", "decimals", "total_supply", "holders_count"
  ]), null, 2));
  const smart = await json(`${BLOCKSCOUT}/api/v2/smart-contracts/${address}`);
  console.log("smartContract", JSON.stringify(pick(smart, [
    "name", "compiler_version", "optimization_enabled", "is_verified", "is_proxy",
    "proxy_type", "implementation_address", "implementations", "constructor_args"
  ]), null, 2));
  if (smart && typeof smart === "object") {
    console.log("abiFunctions", JSON.stringify(functionNames(smart.abi)));
    console.log("abiEvents", JSON.stringify(eventNames(smart.abi)));
  }
}

for (const address of candidates) {
  console.log("\nINTERFACE PROBE", address);
  const nameRaw = await ethCall(address, "0x06fdde03");
  const symbolRaw = await ethCall(address, "0x95d89b41");
  const supplyRaw = await ethCall(address, "0x18160ddd");
  console.log("name", decodeAbiString(nameRaw), nameRaw.slice(0, 138));
  console.log("symbol", decodeAbiString(symbolRaw), symbolRaw.slice(0, 138));
  console.log("totalSupply", decodeUint(supplyRaw), supplyRaw.slice(0, 138));
  for (const iface of ["80ac58cd", "5b5e139f", "d9b67a26", "01ffc9a7"]) {
    const data = `0x01ffc9a7${iface.padEnd(64, "0")}`;
    console.log("supportsInterface", iface, await ethCall(address, data));
  }
  for (const tokenId of [470, 471, 472]) {
    const ownerRaw = await ethCall(address, `0x6352211e${encodeUint(tokenId)}`);
    console.log("ownerOf", tokenId, ownerRaw.startsWith("ERROR:") ? ownerRaw : decodeAddress(ownerRaw), ownerRaw.slice(0, 138));
    const uriRaw = await ethCall(address, `0xc87b56dd${encodeUint(tokenId)}`);
    console.log("tokenURI", tokenId, uriRaw.startsWith("ERROR:") ? uriRaw : decodeAbiString(uriRaw));
  }
}

console.log("\nHOODSTREET FRONTEND PROBE");
try {
  const response = await fetch(HOODSTREET, { redirect: "follow" });
  const html = await response.text();
  console.log("hoodstreetStatus", response.status, "finalUrl", response.url, "htmlBytes", html.length);
  console.log("htmlAddresses", JSON.stringify(addresses(html)));
  for (const needle of ["505A22", "73CB777", "6551", "token-bound", "tokenbound", "CCFF00"]) {
    const found = context(html, needle);
    if (found) console.log("htmlContext", needle, found);
  }
  const scriptSrcs = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]))];
  console.log("scriptCount", scriptSrcs.length);
  const relevant = [];
  for (const src of scriptSrcs.slice(0, 120)) {
    const url = new URL(src, response.url).toString();
    try {
      const scriptResponse = await fetch(url);
      if (!scriptResponse.ok) continue;
      const text = await scriptResponse.text();
      const lower = text.toLowerCase();
      if (["505a22", "73cb777", "6551", "token-bound", "tokenbound", "ccff00"].some((needle) => lower.includes(needle))) {
        const item = { url, bytes: text.length, addresses: addresses(text) };
        for (const needle of ["505A22", "73CB777", "6551", "token-bound", "tokenbound", "CCFF00"]) {
          const found = context(text, needle);
          if (found) item[needle] = found;
        }
        relevant.push(item);
      }
    } catch {}
  }
  console.log("relevantScripts", JSON.stringify(relevant, null, 2));
} catch (error) {
  console.log("hoodstreetError", error instanceof Error ? error.message : String(error));
}

console.log("\nPROBE COMPLETE — no signing, approvals, transactions, deployments, or writes performed.");
