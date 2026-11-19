import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { receiptEvidence, transact, verifyRuntime } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeDeployData, erc20Abi, keccak256, parseAbi, parseEventLogs, stringToHex, toHex, zeroAddress } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";

export async function deployNftAcquisitionFixture({ client, rpc, compilation, assetCompilation, core, coreArtifacts, creator, out }) {
  assert.equal(await client.getChainId(), 31337); assert.equal(new URL(client.transport.url).hostname, "127.0.0.1");
  const seller = privateKeyToAccount(generatePrivateKey()), fee = privateKeyToAccount(generatePrivateKey()), royalty = privateKeyToAccount(generatePrivateKey());
  const owners = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  const signers = new Map([creator, seller, fee, royalty, ...owners].map(account => [account.address.toLowerCase(), account]));
  for (const account of signers.values()) await rpc("anvil_setBalance", [account.address, toHex(20n * 10n ** 18n)]);
  const receipts = [];
  async function send(request, expected = "success", account = creator) {
    assert.ok(signers.has(account.address.toLowerCase())); assert.equal(request.authorizationList, undefined);
    assert.equal(request.accessList, undefined); if (request.from) assert.equal(request.from.toLowerCase(), account.address.toLowerCase());
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (request.nonce !== undefined) assert.equal(BigInt(request.nonce), BigInt(nonce));
    const block = await client.getBlock(), value = BigInt(request.value ?? 0);
    const gas = request.gas ? BigInt(request.gas) : expected === "reverted" ? 12_000_000n
      : (await client.estimateGas({ account: account.address, to: request.to, data: request.data, value })) * 125n / 100n;
    const signed = await account.signTransaction({ chainId: 31337, type: "eip1559", to: request.to, data: request.data, value, nonce, gas,
      maxFeePerGas: BigInt(request.maxFeePerGas ?? (block.baseFeePerGas ?? 1n) * 2n + 1n), maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas ?? 0) });
    const hash = keccak256(signed); assert.equal(await rpc("eth_sendRawTransaction", [signed]), hash);
    const receipt = await client.waitForTransactionReceipt({ hash, checkReplacement: false, timeout: 30_000, pollingInterval: 100 });
    assert.equal(receipt.status, expected); assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
    receipts.push({ ...receiptEvidence(receipt), nonce: String(nonce), from: account.address, to: request.to ?? null }); return receipt;
  }
  const safeArchive = JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/safe-1.4.1/runtime.json", import.meta.url)));
  for (const pin of Object.values(safeArchive.contracts)) {
    assert.equal(keccak256(pin.code), pin.runtimeKeccak256); const code = await client.getCode({ address: pin.address });
    if (!code || code === "0x") await rpc("anvil_setCode", [pin.address, pin.code]);
    assert.equal(keccak256(await client.getCode({ address: pin.address })), pin.runtimeKeccak256);
  }
  const safeAbi = parseAbi(["function setup(address[],uint256,address,bytes,address,address,uint256,address)"]);
  const safeFactoryAbi = parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns(address)", "event ProxyCreation(address indexed proxy,address singleton)"]);
  const initializer = transact(zeroAddress, safeAbi, "setup", [owners.map(owner => owner.address), 2n, zeroAddress, "0x", safeArchive.contracts.compatibility_fallback_handler.address, zeroAddress, 0n, zeroAddress]).data;
  const safeReceipt = await send(transact(safeArchive.contracts.safe_proxy_factory.address, safeFactoryAbi, "createProxyWithNonce", [safeArchive.contracts.safe_l2.address, initializer, 81n]));
  const safeLog = parseEventLogs({ abi: safeFactoryAbi, eventName: "ProxyCreation", strict: true, logs: safeReceipt.logs.filter(log => log.address.toLowerCase() === safeArchive.contracts.safe_proxy_factory.address.toLowerCase()) });
  assert.equal(safeLog.length, 1); const safe = safeLog[0].args.proxy;
  const intent = keccak256(stringToHex("Task081 synthetic eligible project; no live RMT issuance"));
  const projectReceipt = await send({ ...transact(core.factory, coreArtifacts.RMTLaunchCurveFactoryV2.abi, "create",
    ["Synthetic NFT Treasury Project", "tNFTP", "ipfs://local-task081-project", zeroAddress, 0, intent, (await client.getBlock()).timestamp + 300n]), value: BigInt(core.creationFeeWei) });
  const projectToken = await client.readContract({ address: core.factory, abi: coreArtifacts.RMTLaunchCurveFactoryV2.abi, functionName: "tokenForIntent", args: [creator.address, intent] });
  const tokenHash = keccak256(await client.getCode({ address: projectToken }));
  assert.equal(tokenHash, keccak256(coreArtifacts.RMTLaunchCurveTokenV2.runtime));
  assert.equal(await client.readContract({ address: projectToken, abi: erc20Abi, functionName: "totalSupply" }), 1_000_000_000n * 10n ** 18n);
  const deploy = async (artifact, args = []) => {
    const receipt = await send({ data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }) });
    assert.ok(receipt.contractAddress); const address = receipt.contractAddress;
    // Standalone fixtures have no immutables. Production module artifacts retain offsets.
    const runtimeHash = await verifyRuntime(client, address, { ...artifact, immutableReferences: artifact.immutableReferences ?? Object.values(artifact.immutableOffsets ?? {}).flat() });
    return { address, runtimeHash, receipt };
  };
  const payment = await deploy(assetCompilation.artifacts.AcquisitionCurrencyFixture);
  const venue = await deploy(compilation.artifacts.SyntheticNftListingVenueV1, [fee.address, 250]);
  const collections = [];
  for (const [name, standard] of [["Acquisition721Fixture", 721], ["Acquisition1155Fixture", 1155]]) {
    const artifact = assetCompilation.artifacts[name], item = await deploy(artifact, [royalty.address, 500]);
    for (let id = 1; id <= 12; id++) await send(transact(item.address, artifact.abi, "mint", standard === 721 ? [seller.address, BigInt(id)] : [seller.address, BigInt(id), 10n]));
    if (standard === 721) for (let id = 1; id <= 12; id++) await send(transact(item.address, artifact.abi, "approve", [venue.address, BigInt(id)]), "success", seller);
    else await send(transact(item.address, artifact.abi, "setApprovalForAll", [venue.address, true]), "success", seller);
    collections.push({ address: item.address, standard, runtimeHash: item.runtimeHash, sourceInputSha256: "0x" + assetCompilation.manifest.inputSha256,
      name: standard === 721 ? "Synthetic Acquisition 721" : "Synthetic Acquisition 1155", slug: standard === 721 ? "synthetic-acquisition-721" : "synthetic-acquisition-1155",
      deployment: receiptEvidence(item.receipt) });
  }
  const pins = { coreFactory: core.factory, coreFactoryHash: core.factoryRuntimeHash, tokenRuntimeHash: tokenHash,
    venue: venue.address, venueHash: venue.runtimeHash, paymentToken: payment.address, paymentTokenHash: payment.runtimeHash };
  const factory = await deploy(compilation.artifacts.RMTNftAcquisitionFactoryV1, [pins]);
  const vaultIntent = keccak256(stringToHex("Task081 independently funded NFT vault"));
  const vaultReceipt = await send(transact(factory.address, compilation.artifacts.RMTNftAcquisitionFactoryV1.abi, "create", [projectToken, creator.address, vaultIntent]));
  const births = parseEventLogs({ abi: compilation.artifacts.RMTNftAcquisitionFactoryV1.abi, eventName: "VaultCreated", strict: true, logs: vaultReceipt.logs.filter(log => log.address.toLowerCase() === factory.address.toLowerCase()) });
  assert.equal(births.length, 1); const vault = births[0].args.vault;
  const vaultRuntimeHash = await verifyRuntime(client, vault, compilation.artifacts.RMTNftAcquisitionVaultV1), block = await client.getBlock({ blockNumber: vaultReceipt.blockNumber });
  const module = { schemaVersion: 1, profile: "rmt-nft-acquisition-local-v1", chainId: 31337, coreFactory: core.factory, coreFactoryRuntimeHash: core.factoryRuntimeHash,
    factory: factory.address, factoryRuntimeHash: factory.runtimeHash, venue: venue.address, venueRuntimeHash: venue.runtimeHash,
    paymentToken: payment.address, paymentTokenRuntimeHash: payment.runtimeHash, projectToken, creator: creator.address, vault, vaultRuntimeHash, collections,
    deployment: { transactionHash: vaultReceipt.transactionHash, blockNumber: vaultReceipt.blockNumber.toString(), blockHash: vaultReceipt.blockHash, timestamp: new Date(Number(block.timestamp) * 1000).toISOString() },
    compilerInputSha256: compilation.manifest.inputSha256,
    vaultCreationCode: compilation.artifacts.RMTNftAcquisitionVaultV1.bytecode,
    vaultRuntimeTemplate: compilation.artifacts.RMTNftAcquisitionVaultV1.runtime,
    vaultImmutableReferences: compilation.artifacts.RMTNftAcquisitionVaultV1.immutableOffsets,
    vaultImmutableNames: Object.fromEntries(Object.keys(compilation.artifacts.RMTNftAcquisitionVaultV1.immutableOffsets).map(id=>[id,compilation.immutableNames[id]])),
    factoryRuntimeTemplate: compilation.artifacts.RMTNftAcquisitionFactoryV1.runtime,
    factoryImmutableReferences: compilation.artifacts.RMTNftAcquisitionFactoryV1.immutableOffsets,
    factoryImmutableNames: Object.fromEntries(Object.keys(compilation.artifacts.RMTNftAcquisitionFactoryV1.immutableOffsets).map(id=>[id,compilation.immutableNames[id]])) };
  assert.ok(Buffer.byteLength(json(module))<=131072,"Bound local NFT deployment manifest");
  writeFileSync(join(out, "nft-acquisition-deployment.json"), json(module));
  writeFileSync(join(out, "nft-acquisition-compiler-manifest.json"), json(compilation.manifest));
  writeFileSync(join(out, "nft-acquisition-setup.json"), json({ schemaVersion: 1, production: false, chainId: 31337, projectReceipt: receiptEvidence(projectReceipt),
    module, fixtures: assetCompilation.manifest, source: "Synthetic assets, venue and funding only; no real collection admitted", safe: { address: safe, owners: owners.map(owner => owner.address), threshold: 2, receipt: receiptEvidence(safeReceipt) }, receipts }));
  return { module, send, seller, fee, royalty, safe, owners, signers, receipts, assets: assetCompilation.artifacts };
}
