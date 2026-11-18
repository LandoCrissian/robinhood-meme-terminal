// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PurchaseEvidenceV2} from "./PurchaseEvidenceV2.sol";

interface IPurchaseTreasuryV1 {
    function creator() external view returns (address);
    function controller() external view returns (address);
    function controllerEpoch() external view returns (uint64);
    function projectToken() external view returns (address);
    function intentId() external view returns (bytes32);
    function deploymentChainId() external view returns (uint256);
    function available(address asset) external view returns (uint256);
}
interface IPurchaseFactoryV2 { function curveForToken(address token) external view returns (address); }
interface IPurchaseCurve {
    function token() external view returns (address);
    function factory() external view returns (address);
    function active() external view returns (bool);
    function graduated() external view returns (bool);
    function backingReserve() external view returns (uint256);
    function sold() external view returns (uint256);
    function quoteBuy(uint256) external view returns (uint256,uint256,uint256,uint256);
}

/// @notice Local-only, noncustodial V2 route/policy prototype. NOT EXECUTABLE.
/// @dev Not a replacement treasury and cannot inherit V1's beneficiary rights.
/// It has NO payable function, token allowance, outgoing call, upgrade, arbitrary
/// destination, administrator or source-admission switch. Even a syntactically
/// valid reference cannot authorize execution. A purchasing version needs a new
/// reviewed immutable deployment, independent reference and custody design.
contract RMTTreasuryPurchaseV2Prototype {
    struct Binding {
        address treasury; bytes32 treasuryHash; address factory; bytes32 factoryHash;
        address token; bytes32 tokenHash; address curve; bytes32 curveHash;
        address poolManager; bytes32 poolId;
    }
    struct Policy {
        uint128 minimumWei; uint128 perTransactionWei; uint128 perPeriodWei;
        uint32 cooldownSeconds; uint32 periodSeconds; uint16 maxSlippageBps; uint16 maxImpactBps;
    }
    struct Request {
        uint256 amountWei; uint256 minimumTokenOut; uint48 deadline;
        uint64 controllerEpoch; uint64 policyEpoch; bytes32 routeHash;
        uint16 quotedSlippageBps; uint16 quotedImpactBps;
    }
    struct CurveQuote { uint256 tokensOut; uint256 grossUsed; uint256 fee; uint256 refund; uint256 backing; uint256 sold; }
    Binding public binding;
    address public immutable deploymentFactory;
    bytes32 public immutable intentId;
    uint64 public policyEpoch;
    uint64 public policyControllerEpoch;
    bool private intentEnabled;
    Policy public policy;
    bytes32 public immutable curveRouteHash;
    error WrongChain(); error InvalidBinding(); error Unauthorized(); error InvalidPolicy();
    error InvalidRequest(); error IntentDisabled(); error NoIndependentReference(PurchaseEvidenceV2.Status reason); error UnsupportedRoute();
    event PurchaseIntentChanged(uint64 indexed epoch, uint64 indexed controllerEpoch, bool requested, bytes32 policyHash);

    constructor(Binding memory b) {
        if (block.chainid != 31337) revert WrongChain();
        if (b.treasury == address(0) || b.factory == address(0) || b.token == address(0) || b.curve == address(0)
            || b.treasuryHash == bytes32(0) || b.factoryHash == bytes32(0) || b.tokenHash == bytes32(0) || b.curveHash == bytes32(0)
            || b.treasury.codehash != b.treasuryHash || b.factory.codehash != b.factoryHash
            || b.token.codehash != b.tokenHash || b.curve.codehash != b.curveHash) revert InvalidBinding();
        binding = b; deploymentFactory = msg.sender;
        IPurchaseTreasuryV1 t = IPurchaseTreasuryV1(b.treasury);
        if (t.deploymentChainId() != 31337 || t.projectToken() != b.token || t.intentId() == bytes32(0)
            || IPurchaseCurve(b.curve).token() != b.token || IPurchaseCurve(b.curve).factory() != b.factory
            || IPurchaseFactoryV2(b.factory).curveForToken(b.token) != b.curve) revert InvalidBinding();
        intentId = t.intentId();
        curveRouteHash = keccak256(abi.encode("RMT_TREASURY_CURVE_ROUTE_V2_PROTOTYPE", block.chainid, b.treasury,
            b.factory, b.factoryHash, b.token, b.tokenHash, b.curve, b.curveHash));
    }
    function _binding() private view returns (IPurchaseTreasuryV1 t) {
        Binding memory b = binding;
        if (block.chainid != 31337 || b.treasury.codehash != b.treasuryHash || b.factory.codehash != b.factoryHash
            || b.token.codehash != b.tokenHash || b.curve.codehash != b.curveHash) revert InvalidBinding();
        t = IPurchaseTreasuryV1(b.treasury);
        if (t.projectToken() != b.token || t.intentId() != intentId) revert InvalidBinding();
    }
    function _controller() private view returns (IPurchaseTreasuryV1 t) {
        t = _binding(); if (msg.sender != t.controller()) revert Unauthorized();
    }
    function purchaseExecutionAvailable() external pure returns (bool) { return false; }
    function spendingAuthority() external pure returns (bool) { return false; }
    function purchasesEnabled() public view returns (bool) {
        IPurchaseTreasuryV1 t = _binding(); return intentEnabled && policyControllerEpoch == t.controllerEpoch();
    }
    function setPurchaseIntent(Policy calldata p, bool enabled) external {
        IPurchaseTreasuryV1 t = _controller();
        if (p.minimumWei == 0 || p.perTransactionWei < p.minimumWei || p.perPeriodWei < p.perTransactionWei
            || p.cooldownSeconds < 60 || p.periodSeconds < p.cooldownSeconds || p.periodSeconds > 30 days
            || p.maxSlippageBps > 500 || p.maxImpactBps > 500) revert InvalidPolicy();
        policy = p; intentEnabled = enabled; policyControllerEpoch = t.controllerEpoch(); policyEpoch++;
        emit PurchaseIntentChanged(policyEpoch, policyControllerEpoch, enabled, keccak256(abi.encode(p)));
    }
    function disablePurchases() external {
        IPurchaseTreasuryV1 t = _controller(); intentEnabled = false; policyEpoch++; policyControllerEpoch = t.controllerEpoch();
        emit PurchaseIntentChanged(policyEpoch, policyControllerEpoch, false, keccak256(abi.encode(policy)));
    }
    function readCurveQuote(uint256 amount) public view returns (CurveQuote memory q) {
        _binding(); Binding memory b = binding; IPurchaseCurve c = IPurchaseCurve(b.curve);
        if (IPurchaseFactoryV2(b.factory).curveForToken(b.token) != b.curve || !c.active() || c.graduated()) revert UnsupportedRoute();
        q.backing = c.backingReserve(); q.sold = c.sold();
        (q.tokensOut, q.grossUsed, q.fee, q.refund) = c.quoteBuy(amount);
        if (q.tokensOut == 0 || q.grossUsed > amount || q.refund != amount - q.grossUsed || q.fee > q.grossUsed) revert InvalidRequest();
    }
    function inspectReference(PurchaseEvidenceV2.Observation calldata o) public view returns (PurchaseEvidenceV2.Status) {
        _binding(); Binding memory b = binding;
        return PurchaseEvidenceV2.inspect(o, PurchaseEvidenceV2.Context(b.token,b.curve,b.poolManager,b.poolId));
    }
    function reviewRequest(Request calldata r) public view returns (CurveQuote memory q) {
        IPurchaseTreasuryV1 t = _binding(); Policy memory p = policy;
        if (!purchasesEnabled()) revert IntentDisabled();
        if (r.policyEpoch != policyEpoch || r.controllerEpoch != t.controllerEpoch() || r.amountWei < p.minimumWei
            || r.amountWei > p.perTransactionWei || r.amountWei > p.perPeriodWei || r.amountWei > t.available(address(0))
            || r.minimumTokenOut == 0 || r.deadline < block.timestamp || r.deadline > block.timestamp + 5 minutes
            || r.routeHash != curveRouteHash || r.quotedSlippageBps > p.maxSlippageBps || r.quotedImpactBps > p.maxImpactBps) revert InvalidRequest();
        q = readCurveQuote(r.amountWei); if (q.tokensOut < r.minimumTokenOut) revert InvalidRequest();
    }
    function executePurchase(Request calldata r, PurchaseEvidenceV2.Observation calldata o) external view {
        reviewRequest(r);
        // Even well-formed, purportedly independent fields are untrusted. No
        // admitted source or spending authority exists in this immutable code.
        revert NoIndependentReference(inspectReference(o));
    }
}
