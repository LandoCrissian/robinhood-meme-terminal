// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolPins, ITreasuryFactoryCore, ITreasuryCurve, ITreasuryLedger, ITreasuryLpLedger,
    ITreasuryGraduation, ITreasuryPositionManager, ITreasuryERC20, ITreasurySafe} from "./TreasuryInterfaces.sol";

/// @notice Segregated, optional project custody. No RMT administrator or arbitrary calls.
/// @dev V1 deliberately has no admitted independent price source or purchase route.
/// Purchase settings are explicit controller intent; execution always fails closed.
contract RMTProjectTreasuryV1 {
    uint48 public constant NOTICE = 2 days;
    uint48 public constant WINDOW = 7 days;
    uint256 public constant MAX_PENDING_WITHDRAWALS = 16;
    uint256 public constant MAX_ASSETS = 8;
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    bytes32 private constant SAFE_PROXY_HASH = 0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c;
    address private constant SAFE_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    bytes32 private constant SAFE_SINGLETON_HASH = 0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff;
    address private constant SAFE_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    bytes32 private constant SAFE_HANDLER_HASH = 0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9;
    address private constant DELEGATE = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    bytes32 private constant DELEGATE_HASH = 0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0;

    address public immutable creator;
    bytes32 public immutable intentId;
    uint16 public immutable treasuryShareBps;
    uint256 public immutable deploymentChainId;
    address public immutable deploymentFactory;
    bool public controllerInitialized;
    ProtocolPins public pins;
    address public controller;
    uint64 public controllerEpoch = 1;
    address public projectToken;
    address public originCurve;
    address public curveLedger;
    bytes32 public curveLedgerRuntimeHash;
    address public lpLedger;
    bytes32 public lpLedgerRuntimeHash;
    uint256 private entered = 1;

    struct Totals { uint256 manual; uint256 declaredRoyalty; uint256 unsolicited; uint256 curveFees; uint256 lpFees; uint256 withdrawn; uint256 purchased; }
    struct AssetPolicy { bytes32 runtimeHash; bool enabled; }
    struct ControllerNotice { address next; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct AssetNotice { address asset; bytes32 runtimeHash; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct Withdrawal { address asset; address recipient; uint256 amount; uint48 validAfter; uint48 expiresAt; uint64 epoch; uint8 state; }
    struct PurchasePolicy {
        uint128 perTransactionWei; uint128 perPeriodWei; uint128 minimumWei;
        uint32 cooldownSeconds; uint32 periodSeconds; uint16 maxSlippageBps; uint16 maxImpactBps;
    }
    struct PurchaseRequest {
        uint256 amountWei; uint256 minimumTokenOut; uint48 deadline; uint48 quoteObservedAt; uint64 quoteBlock;
        uint64 policyEpoch; bytes32 routeHash; bytes32 referenceHash; uint16 quotedSlippageBps; uint16 quotedImpactBps;
    }
    mapping(address asset => Totals) public totals;
    mapping(address asset => uint256 amount) public accountedHeld;
    mapping(address asset => uint256 amount) public reserved;
    mapping(address asset => AssetPolicy policy) public assetPolicy;
    address[] private admittedAssets;
    ControllerNotice public pendingController;
    AssetNotice public pendingAsset;
    mapping(uint64 id => Withdrawal request) public withdrawals;
    uint64[] private activeWithdrawalIds;
    uint64 public withdrawalNonce;
    uint256 public pendingWithdrawals;
    PurchasePolicy public purchasePolicy;
    bool public purchasesEnabled;
    uint64 public purchasePolicyEpoch;
    // V1 cannot execute purchases. Do not imply mutable execution history or
    // reserve spend that never occurred; a reviewed execution version is needed.
    uint48 public constant lastPurchaseAt = 0;
    uint48 public constant purchasePeriodStartedAt = 0;
    uint256 public constant purchasePeriodSpentWei = 0;

    error Unauthorized(); error InvalidConfiguration(); error InvalidBinding(); error InvalidAsset();
    error InvalidAmount(); error UnsupportedAssetBehavior(); error ReentrantCall(); error NoticeUnavailable();
    error TransferFailed(); error PurchaseDisabled(); error InvalidPurchase(); error UnsupportedIndependentReference();
    event ProjectBound(address indexed token, address indexed originCurve, address indexed curveLedger, uint16 treasuryShareBps);
    event FundingReceived(address indexed asset, address indexed sender, uint8 kind, uint256 amount, bytes32 source);
    event ControllerProposed(address indexed previous, address indexed next, uint64 epoch, uint48 validAfter, uint48 expiresAt);
    event ControllerChangeCancelled(address indexed proposed, uint64 epoch);
    event ControllerChanged(address indexed previous, address indexed next, uint64 epoch);
    event AssetProposed(address indexed asset, bytes32 runtimeHash, uint48 validAfter, uint48 expiresAt, uint64 epoch);
    event AssetAdmissionCancelled(address indexed asset, uint64 epoch);
    event AssetAdmitted(address indexed asset, bytes32 runtimeHash);
    event AssetDisabled(address indexed asset);
    event WithdrawalQueued(uint64 indexed id, address indexed asset, address indexed recipient, uint256 amount, uint48 validAfter, uint48 expiresAt, uint64 epoch);
    event WithdrawalCancelled(uint64 indexed id);
    event WithdrawalExecuted(uint64 indexed id, address indexed asset, address indexed recipient, uint256 amount);
    event ProjectFeesClaimed(address indexed ledger, uint8 assetScope, uint256 nativeAmount, uint256 tokenAmount);
    event PositionFeesCollected(address indexed ledger, uint256 nativeAmount, uint256 tokenAmount);
    event PurchasePolicyChanged(uint64 indexed epoch, bool enabled, bytes32 policyHash);

    modifier nonReentrant() { if (entered != 1) revert ReentrantCall(); entered = 2; _; entered = 1; }
    modifier onlyController() { if (!controllerInitialized || msg.sender != controller) revert Unauthorized(); _; }

    constructor(address creator_, bytes32 intentId_, address controller_, uint16 treasuryShareBps_, ProtocolPins memory pins_) {
        if ((block.chainid != 31337 && block.chainid != 4663) || creator_ == address(0) || intentId_ == bytes32(0)
            || treasuryShareBps_ > 9000 || controller_ == address(0) || pins_.tokenRuntimeHash == bytes32(0)) revert InvalidConfiguration();
        creator = creator_; intentId = intentId_; controller = controller_; treasuryShareBps = treasuryShareBps_;
        deploymentChainId = block.chainid; deploymentFactory = msg.sender; pins = pins_;
    }

    /// @dev The factory performs this in the same CREATE2 transaction. Only the
    /// immutable constructor caller can initialize once; no later admin role.
    function initializeController() external {
        if (msg.sender != deploymentFactory || controllerInitialized || !_supportedController(controller)) revert Unauthorized();
        _pins();
        if (ITreasuryFactoryCore(pins.factory).graduationEngine() != pins.graduationEngine
            || ITreasuryGraduation(pins.graduationEngine).factory() != pins.factory) revert InvalidConfiguration();
        controllerInitialized = true;
    }

    receive() external payable {
        uint8 kind = msg.sender == curveLedger && curveLedger != address(0) ? 3 : msg.sender == lpLedger && lpLedger != address(0) ? 4 : 0;
        _record(address(0), msg.sender, kind, msg.value, bytes32(0));
    }

    function assets() external view returns (address[] memory) { return admittedAssets; }
    function withdrawalIds() external view returns (uint64[] memory) { return activeWithdrawalIds; }
    function purchaseExecutionAvailable() external pure returns (bool) { return false; }
    function available(address asset) public view returns (uint256) { return accountedHeld[asset] - reserved[asset]; }

    function _pins() private view {
        if (block.chainid != deploymentChainId || pins.factory.codehash != pins.factoryRuntimeHash
            || pins.graduationEngine.codehash != pins.graduationRuntimeHash) revert InvalidBinding();
    }

    function bindProject() public returns (address token) {
        _pins();
        token = ITreasuryFactoryCore(pins.factory).tokenForIntent(creator, intentId);
        if (token == address(0) || token.codehash != pins.tokenRuntimeHash || ITreasuryERC20(token).totalSupply() != SUPPLY
            || ITreasuryERC20(token).decimals() != 18) revert InvalidBinding();
        address curve = ITreasuryFactoryCore(pins.factory).originCurveForToken(token);
        ITreasuryCurve market = ITreasuryCurve(curve);
        if (curve.code.length == 0 || market.creator() != creator || market.token() != token || market.factory() != pins.factory
            || market.graduationEngine() != pins.graduationEngine || market.treasuryShareBps() != treasuryShareBps
            || market.treasury() != (treasuryShareBps == 0 ? address(0) : address(this))) revert InvalidBinding();
        address ledger = market.revenueLedger();
        _validatePolicy(ledger);
        if (projectToken == address(0)) {
            projectToken = token; originCurve = curve; curveLedger = ledger; curveLedgerRuntimeHash = ledger.codehash;
            _admit(token, pins.tokenRuntimeHash);
            emit ProjectBound(token, curve, ledger, treasuryShareBps);
        } else if (projectToken != token || originCurve != curve || curveLedger != ledger || ledger.codehash != curveLedgerRuntimeHash) revert InvalidBinding();
    }

    function _validatePolicy(address ledger) private view {
        ITreasuryLedger policy = ITreasuryLedger(ledger);
        if (ledger.code.length == 0 || policy.creator() != creator || policy.treasury() != (treasuryShareBps == 0 ? address(0) : address(this))
            || policy.treasuryShareBps() != treasuryShareBps || policy.operatingRecipient() != ITreasuryFactoryCore(pins.factory).operatingRecipient()
            || policy.futureReserveRecipient() != ITreasuryFactoryCore(pins.factory).futureReserveRecipient()) revert InvalidBinding();
    }

    function claimCurve() external onlyController nonReentrant returns (uint256 amount) {
        bindProject(); _sync(address(0));
        uint256 beforeCredit = totals[address(0)].curveFees;
        amount = ITreasuryLedger(curveLedger).claim();
        if (amount == 0 || totals[address(0)].curveFees - beforeCredit != amount) revert UnsupportedAssetBehavior();
        emit ProjectFeesClaimed(curveLedger, 1, amount, 0);
    }

    function _locked() private view returns (uint256 tokenId, uint128 liquidity) {
        ITreasuryGraduation engine = ITreasuryGraduation(pins.graduationEngine);
        (tokenId, liquidity) = engine.positions(projectToken);
        address manager = engine.positionManager();
        (bool ok, bytes memory hashData) = pins.graduationEngine.staticcall(abi.encodeWithSignature("positionManagerRuntimeHash()"));
        if (!ok || hashData.length != 32 || manager.codehash != abi.decode(hashData, (bytes32)) || tokenId == 0 || liquidity == 0
            || ITreasuryPositionManager(manager).ownerOf(tokenId) != pins.graduationEngine || ITreasuryPositionManager(manager).getApproved(tokenId) != address(0)
            || ITreasuryPositionManager(manager).getPositionLiquidity(tokenId) != liquidity) revert InvalidBinding();
    }

    function _lp() private returns (address ledger) {
        bindProject(); _locked();
        ledger = ITreasuryGraduation(pins.graduationEngine).lpFeeLedger(projectToken);
        _validatePolicy(ledger);
        if (ITreasuryLpLedger(ledger).token() != projectToken || ITreasuryLpLedger(ledger).engine() != pins.graduationEngine) revert InvalidBinding();
        if (lpLedger == address(0)) { lpLedger = ledger; lpLedgerRuntimeHash = ledger.codehash; }
        else if (ledger != lpLedger || ledger.codehash != lpLedgerRuntimeHash) revert InvalidBinding();
    }

    function collectLpFees(uint256 deadline) external onlyController nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount) {
        address ledger = _lp();
        (uint256 tokenId, uint128 liquidity) = _locked();
        if (deadline < block.timestamp || deadline > block.timestamp + 30 minutes) revert InvalidAmount();
        (nativeAmount, tokenAmount) = ITreasuryGraduation(pins.graduationEngine).collectLpFees(projectToken, deadline);
        (uint256 afterId, uint128 afterLiquidity) = _locked();
        if (afterId != tokenId || afterLiquidity != liquidity) revert InvalidBinding();
        emit PositionFeesCollected(ledger, nativeAmount, tokenAmount);
    }

    function claimLp(uint8 asset) external onlyController nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount) {
        if (asset > 2) revert InvalidAsset();
        address ledger = _lp(); _sync(address(0)); _sync(projectToken);
        uint256 beforeNative = totals[address(0)].lpFees;
        uint256 beforeToken = ITreasuryERC20(projectToken).balanceOf(address(this));
        if (asset == 0) (nativeAmount, tokenAmount) = ITreasuryLpLedger(ledger).claim();
        else (nativeAmount, tokenAmount) = ITreasuryLpLedger(ledger).claimAsset(asset == 1);
        if ((nativeAmount == 0 && tokenAmount == 0) || totals[address(0)].lpFees - beforeNative != nativeAmount || (asset == 1 && tokenAmount != 0) || (asset == 2 && nativeAmount != 0)
            || ITreasuryERC20(projectToken).balanceOf(address(this)) != beforeToken + tokenAmount) revert UnsupportedAssetBehavior();
        if (tokenAmount != 0) _record(projectToken, ledger, 4, tokenAmount, bytes32(0));
        _locked(); emit ProjectFeesClaimed(ledger, asset, nativeAmount, tokenAmount);
    }

    function depositNative() external payable { if (msg.value == 0) revert InvalidAmount(); _record(address(0), msg.sender, 1, msg.value, bytes32(0)); }
    function depositRoyaltyNative(bytes32 source) external payable {
        if (msg.value == 0 || source == bytes32(0)) revert InvalidAmount(); _record(address(0), msg.sender, 2, msg.value, source);
    }
    function depositToken(address asset, uint256 amount) external nonReentrant { _depositToken(asset, amount, 1, bytes32(0)); }
    function depositRoyaltyToken(address asset, uint256 amount, bytes32 source) external nonReentrant {
        if (source == bytes32(0)) revert InvalidAmount(); _depositToken(asset, amount, 2, source);
    }
    function _depositToken(address asset, uint256 amount, uint8 kind, bytes32 source) private {
        if (amount == 0 || !assetPolicy[asset].enabled) revert InvalidAsset(); _sync(asset);
        uint256 beforeBalance = ITreasuryERC20(asset).balanceOf(address(this));
        uint256 senderBefore = ITreasuryERC20(asset).balanceOf(msg.sender);
        _tokenCall(asset, abi.encodeCall(ITreasuryERC20.transferFrom, (msg.sender, address(this), amount)));
        if (ITreasuryERC20(asset).balanceOf(address(this)) != beforeBalance + amount
            || ITreasuryERC20(asset).balanceOf(msg.sender) + amount != senderBefore) revert UnsupportedAssetBehavior();
        _record(asset, msg.sender, kind, amount, source);
    }
    function reconcile(address asset) external nonReentrant { _sync(asset); }
    function _sync(address asset) private {
        uint256 actual;
        if (asset == address(0)) actual = address(this).balance;
        else { _asset(asset); actual = ITreasuryERC20(asset).balanceOf(address(this)); }
        if (actual < accountedHeld[asset]) revert UnsupportedAssetBehavior();
        uint256 delta = actual - accountedHeld[asset];
        if (delta != 0) _record(asset, address(0), 0, delta, bytes32(0));
    }
    function _record(address asset, address sender, uint8 kind, uint256 amount, bytes32 source) private {
        accountedHeld[asset] += amount;
        Totals storage t = totals[asset];
        if (kind == 1) t.manual += amount;
        else if (kind == 2) t.declaredRoyalty += amount;
        else if (kind == 3) t.curveFees += amount;
        else if (kind == 4) t.lpFees += amount;
        else t.unsolicited += amount;
        emit FundingReceived(asset, sender, kind, amount, source);
    }
    function _asset(address asset) private view {
        if (assetPolicy[asset].runtimeHash == bytes32(0) || asset.codehash != assetPolicy[asset].runtimeHash) revert InvalidAsset();
    }
    function _tokenCall(address asset, bytes memory data) private {
        _asset(asset);
        (bool ok, bytes memory result) = asset.call(data);
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) revert TransferFailed();
    }
    function _admit(address asset, bytes32 runtimeHash) private {
        if (asset == address(0) || runtimeHash != pins.tokenRuntimeHash || asset.code.length == 0 || asset.codehash != runtimeHash
            || ITreasuryERC20(asset).totalSupply() != SUPPLY || ITreasuryERC20(asset).decimals() != 18) revert InvalidAsset();
        // V1 admits only the already reviewed fixed-supply token implementation
        // and an actual immutable original registration in this core factory.
        // A controller cannot make an unknown/rebasing/FOT token trusted by
        // supplying its runtime hash. Stablecoins and proxies need a new review.
        address original = ITreasuryFactoryCore(pins.factory).originCurveForToken(asset);
        if (original.code.length == 0 || ITreasuryCurve(original).token() != asset || ITreasuryCurve(original).factory() != pins.factory) revert InvalidAsset();
        if (assetPolicy[asset].runtimeHash == bytes32(0)) {
            // Keep one slot for the eventual project token until it is bound.
            if (admittedAssets.length >= (projectToken == address(0) ? MAX_ASSETS - 1 : MAX_ASSETS)) revert InvalidAsset(); admittedAssets.push(asset);
        } else if (assetPolicy[asset].runtimeHash != runtimeHash) revert InvalidAsset();
        assetPolicy[asset] = AssetPolicy(runtimeHash, true); emit AssetAdmitted(asset, runtimeHash);
    }

    function _noticeExpiry(uint48 expiresAt) private view returns (uint48 validAfter) {
        validAfter = uint48(block.timestamp) + NOTICE;
        if (expiresAt <= validAfter || expiresAt > validAfter + WINDOW) revert NoticeUnavailable();
    }
    function proposeAsset(address asset, bytes32 runtimeHash, uint48 expiresAt) external onlyController {
        if (pendingAsset.asset != address(0) || asset == address(0) || runtimeHash != pins.tokenRuntimeHash || asset.code.length == 0 || asset.codehash != runtimeHash) revert InvalidAsset();
        uint48 validAfter = _noticeExpiry(expiresAt);
        pendingAsset = AssetNotice(asset, runtimeHash, validAfter, expiresAt, controllerEpoch);
        emit AssetProposed(asset, runtimeHash, validAfter, expiresAt, controllerEpoch);
    }
    function executeAssetAdmission() external nonReentrant {
        AssetNotice memory n = pendingAsset;
        if (n.asset == address(0) || n.epoch != controllerEpoch || block.timestamp < n.validAfter || block.timestamp > n.expiresAt) revert NoticeUnavailable();
        delete pendingAsset; _admit(n.asset, n.runtimeHash);
    }
    function cancelAssetAdmission() external {
        AssetNotice memory n = pendingAsset;
        if (n.asset == address(0) || (msg.sender != controller && n.epoch == controllerEpoch && block.timestamp <= n.expiresAt)) revert Unauthorized();
        delete pendingAsset; emit AssetAdmissionCancelled(n.asset, n.epoch);
    }
    function disableAsset(address asset) external onlyController { _asset(asset); assetPolicy[asset].enabled = false; emit AssetDisabled(asset); }

    function proposeController(address next, uint48 expiresAt) external onlyController {
        if (pendingController.next != address(0) || next == controller || !_supportedController(next)) revert InvalidConfiguration();
        uint48 validAfter = _noticeExpiry(expiresAt);
        pendingController = ControllerNotice(next, validAfter, expiresAt, controllerEpoch);
        emit ControllerProposed(controller, next, controllerEpoch, validAfter, expiresAt);
    }
    function cancelControllerChange() external {
        ControllerNotice memory n = pendingController;
        if (n.next == address(0) || (msg.sender != controller && block.timestamp <= n.expiresAt)) revert Unauthorized();
        delete pendingController; emit ControllerChangeCancelled(n.next, n.epoch);
    }
    function acceptController() external nonReentrant {
        ControllerNotice memory n = pendingController;
        if (msg.sender != n.next || n.epoch != controllerEpoch || block.timestamp < n.validAfter || block.timestamp > n.expiresAt || !_supportedController(msg.sender)) revert NoticeUnavailable();
        address previous = controller; delete pendingController; controller = msg.sender; controllerEpoch++;
        purchasesEnabled = false; purchasePolicyEpoch++;
        emit ControllerChanged(previous, msg.sender, controllerEpoch);
        emit PurchasePolicyChanged(purchasePolicyEpoch, false, keccak256(abi.encode(purchasePolicy)));
    }

    function queueWithdrawal(address asset, address recipient, uint256 amount, uint48 expiresAt) external onlyController nonReentrant returns (uint64 id) {
        if (recipient == address(0) || recipient == address(this) || amount == 0 || pendingWithdrawals >= MAX_PENDING_WITHDRAWALS) revert InvalidAmount();
        _sync(asset); if (amount > available(asset)) revert InvalidAmount();
        uint48 validAfter = _noticeExpiry(expiresAt); id = ++withdrawalNonce;
        withdrawals[id] = Withdrawal(asset, recipient, amount, validAfter, expiresAt, controllerEpoch, 1);
        reserved[asset] += amount; pendingWithdrawals++; activeWithdrawalIds.push(id);
        emit WithdrawalQueued(id, asset, recipient, amount, validAfter, expiresAt, controllerEpoch);
    }
    function cancelWithdrawal(uint64 id) external nonReentrant {
        Withdrawal storage w = withdrawals[id];
        if (w.state != 1 || (msg.sender != controller && w.epoch == controllerEpoch && block.timestamp <= w.expiresAt)) revert Unauthorized();
        w.state = 2; _releaseWithdrawal(id, w.asset, w.amount); emit WithdrawalCancelled(id);
    }
    function executeWithdrawal(uint64 id) external nonReentrant {
        Withdrawal storage w = withdrawals[id];
        if (w.state != 1 || w.epoch != controllerEpoch || block.timestamp < w.validAfter || block.timestamp > w.expiresAt) revert NoticeUnavailable();
        _sync(w.asset);
        address asset = w.asset; address recipient = w.recipient; uint256 amount = w.amount;
        w.state = 3; _releaseWithdrawal(id, asset, amount); accountedHeld[asset] -= amount; totals[asset].withdrawn += amount;
        if (asset == address(0)) { (bool ok,) = payable(recipient).call{value: amount}(""); if (!ok) revert TransferFailed(); }
        else {
            uint256 beforeRecipient = ITreasuryERC20(asset).balanceOf(recipient);
            uint256 beforeTreasury = ITreasuryERC20(asset).balanceOf(address(this));
            _tokenCall(asset, abi.encodeCall(ITreasuryERC20.transfer, (recipient, amount)));
            if (ITreasuryERC20(asset).balanceOf(address(this)) + amount != beforeTreasury || ITreasuryERC20(asset).balanceOf(recipient) != beforeRecipient + amount) revert UnsupportedAssetBehavior();
        }
        emit WithdrawalExecuted(id, asset, recipient, amount);
    }
    function _releaseWithdrawal(uint64 id, address asset, uint256 amount) private {
        reserved[asset] -= amount; pendingWithdrawals--;
        for (uint256 i; i < activeWithdrawalIds.length; i++) {
            if (activeWithdrawalIds[i] == id) {
                activeWithdrawalIds[i] = activeWithdrawalIds[activeWithdrawalIds.length - 1];
                activeWithdrawalIds.pop(); return;
            }
        }
        revert InvalidBinding();
    }

    function setPurchasePolicy(PurchasePolicy calldata policy, bool enabled) external onlyController {
        if (policy.minimumWei == 0 || policy.perTransactionWei < policy.minimumWei || policy.perPeriodWei < policy.perTransactionWei
            || policy.cooldownSeconds < 60 || policy.periodSeconds < policy.cooldownSeconds || policy.periodSeconds > 30 days
            || policy.maxSlippageBps > 500 || policy.maxImpactBps > 500) revert InvalidPurchase();
        purchasePolicy = policy; purchasesEnabled = enabled; purchasePolicyEpoch++;
        emit PurchasePolicyChanged(purchasePolicyEpoch, enabled, keccak256(abi.encode(policy)));
    }
    function disablePurchases() external onlyController { purchasesEnabled = false; purchasePolicyEpoch++; emit PurchasePolicyChanged(purchasePolicyEpoch, false, keccak256(abi.encode(purchasePolicy))); }
    function validatePurchase(PurchaseRequest calldata request) public view {
        PurchasePolicy memory p = purchasePolicy;
        if (!purchasesEnabled) revert PurchaseDisabled();
        if (projectToken == address(0) || request.policyEpoch != purchasePolicyEpoch || request.amountWei < p.minimumWei
            || request.amountWei > p.perTransactionWei || request.amountWei > available(address(0)) || request.minimumTokenOut == 0
            || request.deadline < block.timestamp || request.deadline > block.timestamp + 5 minutes
            || request.quoteObservedAt > block.timestamp || block.timestamp - request.quoteObservedAt > 60
            || request.quoteBlock >= block.number || block.number - request.quoteBlock > 64
            || request.quotedSlippageBps > p.maxSlippageBps || request.quotedImpactBps > p.maxImpactBps
            || request.routeHash == bytes32(0) || request.referenceHash == bytes32(0)
            || (lastPurchaseAt != 0 && block.timestamp < lastPurchaseAt + p.cooldownSeconds)
            || request.amountWei + (block.timestamp < purchasePeriodStartedAt + p.periodSeconds ? purchasePeriodSpentWei : 0) > p.perPeriodWei) revert InvalidPurchase();
    }
    function executePurchase(PurchaseRequest calldata request) external view {
        validatePurchase(request);
        // A caller-provided quote/hash is NOT independent market evidence.
        // No arbitrary pluggable destination or future admin override exists.
        revert UnsupportedIndependentReference();
    }

    function _supportedController(address account) private view returns (bool) {
        if (uint160(account) <= 0xffff || account == address(this)) return false;
        if (account.code.length == 0) return true;
        if (account.codehash == keccak256(abi.encodePacked(hex"ef0100", DELEGATE))) return DELEGATE.codehash == DELEGATE_HASH;
        if (account.codehash != SAFE_PROXY_HASH || SAFE_SINGLETON.codehash != SAFE_SINGLETON_HASH) return false;
        if (SAFE_HANDLER.codehash != SAFE_HANDLER_HASH) return false;
        try ITreasurySafe(account).masterCopy() returns (address singleton) { if (singleton != SAFE_SINGLETON) return false; } catch { return false; }
        try ITreasurySafe(account).getThreshold() returns (uint256 threshold) { if (threshold != 2) return false; } catch { return false; }
        try ITreasurySafe(account).getModulesPaginated(address(1), 1) returns (address[] memory modules, address next) {
            if (modules.length != 0 || next != address(1)) return false;
        } catch { return false; }
        if (!_safeSlot(account, keccak256("guard_manager.guard.address"), bytes32(0))
            || !_safeSlot(account, keccak256("fallback_manager.handler.address"), bytes32(uint256(uint160(SAFE_HANDLER))))) return false;
        try ITreasurySafe(account).getOwners() returns (address[] memory owners) {
            if (owners.length != 3 || owners[0] == owners[1] || owners[0] == owners[2] || owners[1] == owners[2]) return false;
            for (uint256 i; i < 3; i++) if (owners[i] == address(0) || owners[i].code.length != 0) return false;
            return true;
        } catch { return false; }
    }
    function _safeSlot(address account, bytes32 slot, bytes32 expected) private view returns (bool) {
        try ITreasurySafe(account).getStorageAt(uint256(slot), 1) returns (bytes memory value) {
            return value.length == 32 && abi.decode(value, (bytes32)) == expected;
        } catch { return false; }
    }
}
