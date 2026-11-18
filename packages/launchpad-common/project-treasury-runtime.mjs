const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && BigInt(value) > 0xffffn;
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

/** Materialize every constructor immutable, rather than accepting one observed
 * project's runtime hash for all CREATE2 treasuries. Unknown AST names, missing
 * fields, overlapping offsets or changed compiler layouts fail closed. */
export function materializeProjectTreasuryRuntime(template, references, names, fields) {
  if (typeof template !== "string" || !/^0x(?:[0-9a-f]{2}){1,24576}$/i.test(template)
    || !references || typeof references !== "object" || Array.isArray(references)
    || !names || typeof names !== "object" || Array.isArray(names)
    || !fields || !address(fields.creator) || !address(fields.deploymentFactory) || !hash(fields.intentId)
    || !Number.isInteger(fields.treasuryShareBps) || fields.treasuryShareBps < 0 || fields.treasuryShareBps > 9000
    || fields.deploymentChainId !== 31337 && fields.deploymentChainId !== 4663) throw Error("Treasury runtime inputs unavailable");
  const values = { creator: BigInt(fields.creator), deploymentFactory: BigInt(fields.deploymentFactory), intentId: BigInt(fields.intentId),
    treasuryShareBps: BigInt(fields.treasuryShareBps), deploymentChainId: BigInt(fields.deploymentChainId) };
  const entries = Object.entries(references);
  if (entries.length !== 5 || new Set(entries.map(([id]) => names[id])).size !== 5) throw Error("Treasury immutable coverage changed");
  const offsets = [], seen = new Set();
  for (const [id, spans] of entries) {
    if (!/^\d+$/.test(id) || !Object.hasOwn(values, names[id]) || !Array.isArray(spans) || !spans.length || spans.length > 32) throw Error("Treasury immutable layout unavailable");
    for (const span of spans) {
      if (!span || !Number.isSafeInteger(span.start) || span.start < 0 || span.length !== 32 || 2 * (span.start + span.length) > template.length - 2) throw Error("Treasury immutable offset invalid");
      for (let byte = span.start; byte < span.start + 32; byte++) {
        if (seen.has(byte)) throw Error("Treasury immutable offsets overlap"); seen.add(byte);
      }
      offsets.push({ start: span.start * 2, word: values[names[id]].toString(16).padStart(64, "0") });
    }
  }
  let runtime = template.slice(2).toLowerCase();
  for (const { start, word } of offsets.sort((a, b) => b.start - a.start)) runtime = runtime.slice(0, start) + word + runtime.slice(start + 64);
  return "0x" + runtime;
}

export const projectTreasuryFactorySignatures = [
  "function pins() view returns (address factory,bytes32 factoryRuntimeHash,address graduationEngine,bytes32 graduationRuntimeHash,bytes32 tokenRuntimeHash)",
  "function deploymentChainId() view returns(uint256)",
  "function treasuryForIntent(address creator,bytes32 intentId) view returns(address)",
  "function salt(address creator,bytes32 intentId) view returns(bytes32)",
  "function treasuryCreationCodeHash() view returns(bytes32)",
  "function predict(address creator,bytes32 intentId,address controller,uint16 treasuryShareBps,bytes creationCode) view returns(address)",
  "function create(bytes32 intentId,address controller,uint16 treasuryShareBps,bytes creationCode) returns(address)",
  "event TreasuryCreated(address indexed creator,bytes32 indexed intentId,address indexed treasury,address controller,uint16 treasuryShareBps)",
];
export const projectTreasurySignatures = [
  "function creator() view returns(address)", "function intentId() view returns(bytes32)",
  "function deploymentFactory() view returns(address)", "function controllerInitialized() view returns(bool)",
  "function controller() view returns(address)", "function controllerEpoch() view returns(uint64)",
  "function treasuryShareBps() view returns(uint16)", "function deploymentChainId() view returns(uint256)",
  "function pins() view returns(address factory,bytes32 factoryRuntimeHash,address graduationEngine,bytes32 graduationRuntimeHash,bytes32 tokenRuntimeHash)",
  "function projectToken() view returns(address)", "function originCurve() view returns(address)",
  "function curveLedger() view returns(address)", "function lpLedger() view returns(address)",
  "function bindProject() returns(address)", "function claimCurve() returns(uint256)",
  "function collectLpFees(uint256 deadline) returns(uint256,uint256)",
  "function claimLp(uint8 asset) returns(uint256,uint256)",
  "function assets() view returns(address[])",
  "function assetPolicy(address asset) view returns(bytes32 runtimeHash,bool enabled)",
  "function accountedHeld(address asset) view returns(uint256)", "function reserved(address asset) view returns(uint256)",
  "function totals(address asset) view returns(uint256 manual,uint256 declaredRoyalty,uint256 unsolicited,uint256 curveFees,uint256 lpFees,uint256 withdrawn,uint256 purchased)",
  "function pendingController() view returns(address next,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "function proposeController(address next,uint48 expiresAt)", "function cancelControllerChange()", "function acceptController()",
  "function withdrawalNonce() view returns(uint64)", "function pendingWithdrawals() view returns(uint256)",
  "function withdrawalIds() view returns(uint64[])",
  "function withdrawals(uint64 id) view returns(address asset,address recipient,uint256 amount,uint48 validAfter,uint48 expiresAt,uint64 epoch,uint8 state)",
  "function queueWithdrawal(address asset,address recipient,uint256 amount,uint48 expiresAt) returns(uint64)",
  "function cancelWithdrawal(uint64 id)", "function executeWithdrawal(uint64 id)",
  "function depositNative() payable", "function depositRoyaltyNative(bytes32 source) payable",
  "function depositToken(address asset,uint256 amount)", "function depositRoyaltyToken(address asset,uint256 amount,bytes32 source)",
  "function reconcile(address asset)",
  "function purchasesEnabled() view returns(bool)", "function purchaseExecutionAvailable() pure returns(bool)",
  "function purchasePolicyEpoch() view returns(uint64)", "function lastPurchaseAt() view returns(uint48)",
  "function purchasePolicy() view returns(uint128 perTransactionWei,uint128 perPeriodWei,uint128 minimumWei,uint32 cooldownSeconds,uint32 periodSeconds,uint16 maxSlippageBps,uint16 maxImpactBps)",
  "function setPurchasePolicy((uint128 perTransactionWei,uint128 perPeriodWei,uint128 minimumWei,uint32 cooldownSeconds,uint32 periodSeconds,uint16 maxSlippageBps,uint16 maxImpactBps) policy,bool enabled)",
  "function disablePurchases()",
  "event ProjectBound(address indexed token,address indexed originCurve,address indexed curveLedger,uint16 treasuryShareBps)",
  "event FundingReceived(address indexed asset,address indexed sender,uint8 kind,uint256 amount,bytes32 source)",
  "event ControllerProposed(address indexed previous,address indexed next,uint64 epoch,uint48 validAfter,uint48 expiresAt)",
  "event ControllerChangeCancelled(address indexed proposed,uint64 epoch)",
  "event ControllerChanged(address indexed previous,address indexed next,uint64 epoch)",
  "event AssetProposed(address indexed asset,bytes32 runtimeHash,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "event AssetAdmissionCancelled(address indexed asset,uint64 epoch)",
  "event AssetAdmitted(address indexed asset,bytes32 runtimeHash)", "event AssetDisabled(address indexed asset)",
  "event WithdrawalQueued(uint64 indexed id,address indexed asset,address indexed recipient,uint256 amount,uint48 validAfter,uint48 expiresAt,uint64 epoch)",
  "event WithdrawalCancelled(uint64 indexed id)",
  "event WithdrawalExecuted(uint64 indexed id,address indexed asset,address indexed recipient,uint256 amount)",
  "event ProjectFeesClaimed(address indexed ledger,uint8 assetScope,uint256 nativeAmount,uint256 tokenAmount)",
  "event PositionFeesCollected(address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)",
  "event PurchasePolicyChanged(uint64 indexed epoch,bool enabled,bytes32 policyHash)",
];
