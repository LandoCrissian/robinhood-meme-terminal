import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, parseAbi, parseAbiItem, parseEventLogs, toHex, zeroAddress, type Hex } from "viem";
import { emptyLaunchDraft, validateLaunchDraft } from "../launch-draft";
import { testCreationChain, type TestCreationRequest } from "../test-creation";
import { configuredCurveFixture, factoryAbi, fixtureAddress, fixtureCreationFee, fixtureHash, fixtureRpc, sameHex, verifyCurveFixture, type CurveFixture } from "./curve-fixture";
import { readDraftBody } from "./launch-draft";
import { readFixtureLaunches } from "./fixture-discovery";

const maxDeadlineSeconds = 300n;
const recoveryRange = 256n;
const feeHex = toHex(fixtureCreationFee);
const created = parseAbiItem("event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)");
const paid = parseAbiItem("event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)");
const registered = parseAbiItem("event ProjectRegistered(address indexed token,address indexed factory,address indexed curve,uint32 version)");
const curveAbi = parseAbi([
  "function factory() view returns (address)", "function token() view returns (address)", "function creator() view returns (address)",
  "function treasury() view returns (address)", "function treasuryShareBps() view returns (uint16)", "function sold() view returns (uint256)",
  "function backingReserve() view returns (uint256)", "function totalSupply() view returns (uint256)",
  "function GRADUATION_BACKING() view returns (uint256)",
]);

const keys = (value: unknown, names: string[]): value is Record<string, unknown> => !!value && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const asAddress = (address: string) => getAddress(address.toLowerCase());
const decimal = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,11}$/.test(value);
const calldata = (value: unknown): value is Hex => typeof value === "string" && value.length <= 2304 && /^0x(?:[0-9a-f]{2})+$/i.test(value);
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store" } });
const unavailable = () => reply({ status: "unavailable" });

function normalizedFields(fields: unknown) {
  if (!keys(fields, ["name", "symbol", "projectURI", "supplyPreset", "treasury", "treasuryShareBps"]) ||
      typeof fields.name !== "string" || typeof fields.symbol !== "string" || typeof fields.projectURI !== "string" ||
      typeof fields.treasury !== "string" || typeof fields.supplyPreset !== "number" || !Number.isInteger(fields.supplyPreset) ||
      typeof fields.treasuryShareBps !== "number" || !Number.isInteger(fields.treasuryShareBps) || fields.treasuryShareBps < 0) return null;
  const checked = validateLaunchDraft({ ...emptyLaunchDraft, name: fields.name, symbol: fields.symbol, projectURI: fields.projectURI,
    supplyPreset: String(fields.supplyPreset), treasury: fields.treasury, treasuryShare: fields.treasuryShareBps ? (fields.treasuryShareBps / 100).toFixed(2) : "" });
  if (!checked.ok) return null;
  const draft = checked.draft;
  return draft.name === fields.name && draft.symbol === fields.symbol && draft.projectURI === fields.projectURI && draft.supplyPreset === fields.supplyPreset
    && draft.treasury === fields.treasury && draft.treasuryShareBps === fields.treasuryShareBps ? draft : null;
}

function preparedRequest(fixture: CurveFixture, raw: unknown): TestCreationRequest | null {
  if (!keys(raw, ["from", "to", "data", "value", "chainId", "intentId", "deadline", "blockNumber", "blockHash"]) ||
    !fixtureAddress(raw.from) || raw.to !== fixture.factory || raw.chainId !== testCreationChain || raw.value !== feeHex || !fixtureHash(raw.intentId) ||
    !decimal(raw.deadline) || !calldata(raw.data) || raw.blockNumber !== toHex(fixture.deploymentBlock) || raw.blockHash !== fixture.deploymentBlockHash) return null;
  const decoded = decodeFunctionData({ abi: factoryAbi, data: raw.data });
  if (decoded.functionName !== "create") return null;
  const [name, symbol, projectURI, supplyPreset, treasury, treasuryShareBps, intentId, deadline] = decoded.args;
  if (!normalizedFields({ name, symbol, projectURI, supplyPreset, treasury: sameHex(treasury, zeroAddress) ? "" : treasury.toLowerCase(), treasuryShareBps }) ||
      sameHex(treasury, raw.from) || !sameHex(intentId, raw.intentId) || deadline !== BigInt(raw.deadline) ||
      !sameHex(encodeFunctionData({ abi: factoryAbi, functionName: "create", args: decoded.args }), raw.data)) return null;
  return { from: asAddress(raw.from), to: fixture.factory, data: raw.data, value: feeHex, chainId: testCreationChain, intentId: raw.intentId,
    deadline: raw.deadline, blockNumber: toHex(fixture.deploymentBlock), blockHash: fixture.deploymentBlockHash };
}

async function prepare(fixture: CurveFixture, body: Record<string, unknown>) {
  const draft = normalizedFields(body.fields);
  if (!draft || !fixtureAddress(body.account) || !fixtureHash(body.intentId) || sameHex(draft.treasury, body.account) ||
      (body.deadline !== undefined && !decimal(body.deadline))) return reply({ status: "invalid" }, 422);
  const from = asAddress(body.account);
  const rpc = fixtureRpc(fixture);
  const head = await verifyCurveFixture(fixture, rpc);
  const deadline = body.deadline === undefined ? head.timestamp + maxDeadlineSeconds : BigInt(body.deadline as string);
  if (deadline <= head.timestamp || deadline > head.timestamp + maxDeadlineSeconds) return reply({ status: "invalid" }, 422);
  const args = [draft.name, draft.symbol, draft.projectURI, draft.supplyPreset, draft.treasury ? asAddress(draft.treasury) : zeroAddress,
    draft.treasuryShareBps, body.intentId, deadline] as const;
  await rpc.simulateContract({ address: fixture.factory, abi: factoryAbi, functionName: "create", account: from, args, value: fixtureCreationFee });
  const request: TestCreationRequest = { from, to: fixture.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "create", args }),
    value: feeHex, chainId: testCreationChain, intentId: body.intentId, deadline: deadline.toString(),
    blockNumber: toHex(fixture.deploymentBlock), blockHash: fixture.deploymentBlockHash };
  return reply({ status: "prepared", request });
}

async function verify(fixture: CurveFixture, body: Record<string, unknown>) {
  const request = preparedRequest(fixture, body.request);
  if (!request || (body.transactionHash !== undefined && !fixtureHash(body.transactionHash))) return reply({ status: "invalid" }, 422);
  const rpc = fixtureRpc(fixture);
  const head = await verifyCurveFixture(fixture, rpc);
  let hash = body.transactionHash as Hex | undefined;
  if (!hash) {
    const token = await rpc.readContract({ address: fixture.factory, abi: factoryAbi, functionName: "tokenForIntent", args: [request.from, request.intentId] });
    if (sameHex(token, zeroAddress)) return head.timestamp > BigInt(request.deadline) ? unavailable() : reply({ status: "pending" });
    const fromBlock = head.number - fixture.deploymentBlock < recoveryRange ? fixture.deploymentBlock : head.number - recoveryRange;
    const logs = await rpc.getLogs({ address: fixture.factory, event: created, args: { token, creator: request.from }, fromBlock, toBlock: head.number });
    if (logs.length !== 1 || logs[0].removed || !fixtureHash(logs[0].transactionHash)) return unavailable();
    hash = logs[0].transactionHash;
  }
  const tx = await rpc.getTransaction({ hash });
  if (!sameHex(tx.hash, hash) || !sameHex(tx.from, request.from) || !sameHex(tx.to, request.to) || !sameHex(tx.input, request.data)
      || tx.value !== fixtureCreationFee || tx.chainId !== 31337) return unavailable();
  if (tx.blockNumber === null) return reply({ status: "pending", transactionHash: hash });
  const receipt = await rpc.getTransactionReceipt({ hash });
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (!sameHex(receipt.transactionHash, hash) || !sameHex(receipt.from, request.from) || !sameHex(receipt.to, request.to)
      || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex || !sameHex(tx.blockHash, receipt.blockHash)
      || block.number !== receipt.blockNumber || !sameHex(block.hash, receipt.blockHash) || !sameHex(block.transactions[receipt.transactionIndex], hash)
      || receipt.blockNumber < fixture.deploymentBlock || receipt.logs.length > 80) return unavailable();
  if (receipt.status === "reverted") return reply({ status: "reverted", transactionHash: hash });
  if (receipt.status !== "success" || block.timestamp > BigInt(request.deadline)) return unavailable();

  const validLogs = receipt.logs.every((log) => !log.removed && sameHex(log.blockHash, receipt.blockHash) &&
    log.blockNumber === receipt.blockNumber && sameHex(log.transactionHash, hash) && log.transactionIndex === receipt.transactionIndex &&
    log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0 && log.data.length <= 10_000);
  if (!validLogs || new Set(receipt.logs.map((log) => log.logIndex)).size !== receipt.logs.length) return unavailable();
  const factoryLogs = receipt.logs.filter((log) => sameHex(log.address, fixture.factory));
  const createdLogs = parseEventLogs({ abi: [created], logs: factoryLogs });
  const feeLogs = parseEventLogs({ abi: [paid], logs: factoryLogs });
  const registryLogs = parseEventLogs({ abi: [registered], logs: receipt.logs.filter((log) => sameHex(log.address, fixture.registry)) });
  if (createdLogs.length !== 1 || feeLogs.length !== 1 || registryLogs.length !== 1) return unavailable();
  const creation = createdLogs[0];
  const c = creation.args;
  const charge = feeLogs[0];
  const fee = charge.args;
  const project = registryLogs[0];
  const decoded = decodeFunctionData({ abi: factoryAbi, data: request.data });
  if (decoded.functionName !== "create") return unavailable();
  const [name, symbol, uri, preset, treasury, share, intent] = decoded.args;
  const supply = 1_000_000n * 10n ** (18n + BigInt(preset));
  if (![c.token, c.curve, c.revenueLedger].every(fixtureAddress)
      || new Set([fixture.factory, fixture.registry, c.token, c.curve, c.revenueLedger].map((address) => address.toLowerCase())).size !== 5
      || !sameHex(c.creator, request.from) || !sameHex(c.intentId, intent) || c.name !== name || c.symbol !== symbol
      || c.projectURI !== uri || c.supply !== supply || !sameHex(c.treasury, treasury) || c.treasuryShareBps !== share
      || !sameHex(fee.token, c.token) || !sameHex(fee.creator, request.from) || !sameHex(fee.recipient, fixture.feeRecipient)
      || fee.fee !== fixtureCreationFee || fee.refund !== 0n
      || project.args.version !== 1 || !sameHex(project.args.token, c.token) || !sameHex(project.args.factory, fixture.factory) || !sameHex(project.args.curve, c.curve)
      || project.logIndex >= creation.logIndex || creation.logIndex >= charge.logIndex) return unavailable();

  const at = { blockNumber: receipt.blockNumber };
  const curve = { address: c.curve, abi: curveAbi, ...at } as const;
  const token = { address: c.token, abi: erc20Abi, ...at } as const;
  const [bound, curveFactory, curveToken, creator, curveTreasury, curveShare, boardSupply, tokenName, tokenSymbol, sold, backing, inventory, target] = await Promise.all([
    rpc.readContract({ address: fixture.factory, abi: factoryAbi, functionName: "originCurveForToken", args: [c.token], ...at }),
    rpc.readContract({ ...curve, functionName: "factory" }), rpc.readContract({ ...curve, functionName: "token" }),
    rpc.readContract({ ...curve, functionName: "creator" }), rpc.readContract({ ...curve, functionName: "treasury" }),
    rpc.readContract({ ...curve, functionName: "treasuryShareBps" }), rpc.readContract({ ...token, functionName: "totalSupply" }),
    rpc.readContract({ ...token, functionName: "name" }), rpc.readContract({ ...token, functionName: "symbol" }),
    rpc.readContract({ ...curve, functionName: "sold" }), rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...token, functionName: "balanceOf", args: [c.curve] }), rpc.readContract({ ...curve, functionName: "GRADUATION_BACKING" }),
  ]);
  if (!sameHex(bound, c.curve) || !sameHex(curveFactory, fixture.factory) || !sameHex(curveToken, c.token) || !sameHex(creator, request.from)
      || !sameHex(curveTreasury, treasury) || curveShare !== share || boardSupply !== supply || tokenName !== name || tokenSymbol !== symbol
      || sold !== 0n || backing !== 0n || inventory !== supply || target !== 2n * 10n ** 18n) return unavailable();
  const discovery = await readFixtureLaunches(fixture, c.token);
  const indexed = discovery.status === "ready" && discovery.launches.some((launch) => sameHex(launch.creation.transactionHash, hash)
    && sameHex(launch.creation.blockHash, receipt.blockHash) && launch.creation.logIndex === creation.logIndex);
  const canonical = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (!sameHex(canonical.hash, receipt.blockHash)) return unavailable();
  return reply({ status: "confirmed", transactionHash: hash, token: c.token, indexed });
}

export async function handleTestCreation(request: Request) {
  const fixture = configuredCurveFixture(request.headers);
  if (!fixture || request.method !== "POST") return reply({ status: "unavailable" }, 404);
  if (request.headers.get("origin") !== fixture.origin || new URL(request.url).search) return reply({ status: "invalid" }, 403);
  const declared = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body ||
    (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096))) return reply({ status: "invalid" }, 400);
  try {
    const payload = await readDraftBody(request.body);
    if (payload.tooLarge) return reply({ status: "invalid" }, 413);
    const body = payload.input as Record<string, unknown> | null;
    if (keys(body, ["action", "fields", "account", "intentId", ...(body && Object.hasOwn(body, "deadline") ? ["deadline"] : [])]) && body.action === "prepare") {
      return await prepare(fixture, body);
    }
    if (keys(body, ["action", "request", ...(body && Object.hasOwn(body, "transactionHash") ? ["transactionHash"] : [])]) && body.action === "verify") {
      return await verify(fixture, body);
    }
    return reply({ status: "invalid" }, 400);
  } catch {
    return unavailable();
  }
}
