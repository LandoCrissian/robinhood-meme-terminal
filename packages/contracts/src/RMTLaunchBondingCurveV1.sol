// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRMTLaunchCurveExecution} from "./interfaces/IRMTLaunchCurveExecution.sol";
import {IRMTV4CurveGraduationV1} from "./interfaces/IRMTV4CurveGraduationV1.sol";
import {RMTLaunchCurveMathV1} from "./RMTLaunchCurveMathV1.sol";
import {RMTLaunchCurveRevenueLedgerV1} from "./RMTLaunchCurveRevenueLedgerV1.sol";

/// @notice Immutable, native-ETH bonding curve for one fixed-supply launch.
contract RMTLaunchBondingCurveV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = RMTLaunchCurveMathV1.BPS;
    uint256 public constant TRADE_FEE_BPS = RMTLaunchCurveMathV1.TRADE_FEE_BPS;
    uint256 public constant VIRTUAL_ETH = RMTLaunchCurveMathV1.VIRTUAL_ETH;
    uint256 public constant GRADUATION_BACKING = RMTLaunchCurveMathV1.GRADUATION_BACKING;
    bytes32 public constant economicRules = RMTLaunchCurveMathV1.ECONOMIC_RULES;

    address public immutable factory;
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable treasury;
    uint16 public immutable treasuryShareBps;
    address public immutable operatingRecipient;
    address public immutable futureReserveRecipient;
    IRMTV4CurveGraduationV1 public immutable graduationEngine;
    RMTLaunchCurveRevenueLedgerV1 public immutable revenueLedger;
    uint256 public immutable totalSupply;
    uint256 public immutable virtualToken;
    uint256 public immutable graduationSold;
    address public immutable projectRegistry;
    address public immutable migrationSource;

    uint256 public sold;
    uint256 public backingReserve;
    bool public graduated;
    bytes32 public poolId;
    uint256 public positionTokenId;
    uint256 public nativeDust;
    uint256 public tokenDust;
    address public migratedTo;
    bool public active;
    bool private receivingGraduationRefund;
    uint256 private graduationRefund;

    struct BuyFill {
        uint256 tokensOut;
        uint256 grossUsed;
        uint256 fee;
        uint256 refund;
    }

    error InvalidConfiguration();
    error InvalidTrade();
    error SlippageExceeded();
    error DeadlineExpired();
    error CurveClosed();
    error GraduationNotReady();
    error InvalidGraduationSettlement();
    error UnauthorizedNativeTransfer();
    error NativeTransferFailed();
    error UnauthorizedMigration();
    error InvalidMigrationSettlement();

    event CurveTrade(
        address indexed account,
        bool indexed isBuy,
        uint256 tokenAmount,
        uint256 grossNative,
        uint256 fee,
        uint256 nativeRefund,
        uint256 sold,
        uint256 backingReserve
    );
    event CurveGraduated(
        bytes32 indexed poolId,
        uint256 indexed positionTokenId,
        uint256 nativeUsed,
        uint256 tokenUsed,
        uint256 nativeDust,
        uint256 tokenDust
    );

    constructor(
        IERC20 token_,
        address creator_,
        address treasury_,
        uint16 treasuryShareBps_,
        address operatingRecipient_,
        address futureReserveRecipient_,
        IRMTV4CurveGraduationV1 graduationEngine_,
        address projectRegistry_,
        address factory_,
        address migrationSource_,
        RMTLaunchCurveRevenueLedgerV1 revenueLedger_
    ) {
        factory = factory_;
        projectRegistry = projectRegistry_;
        migrationSource = migrationSource_;
        active = migrationSource_ == address(0);
        token = token_;
        creator = creator_;
        treasury = treasury_;
        treasuryShareBps = treasuryShareBps_;
        operatingRecipient = operatingRecipient_;
        futureReserveRecipient = futureReserveRecipient_;
        graduationEngine = graduationEngine_;
        uint256 supply = token_.totalSupply();
        if (supply != 1_000_000 ether && supply != 10_000_000 ether && supply != 100_000_000 ether) {
            revert InvalidConfiguration();
        }
        totalSupply = supply;
        virtualToken = supply * 9 / 5;
        graduationSold = supply * 3 / 5;
        revenueLedger = active
            ? new RMTLaunchCurveRevenueLedgerV1(
                creator_, treasury_, treasuryShareBps_, operatingRecipient_, futureReserveRecipient_
            )
            : revenueLedger_;
    }

    receive() external payable {
        if (
            !receivingGraduationRefund || msg.sender != address(graduationEngine) || msg.value == 0
                || graduationRefund != 0
        ) revert UnauthorizedNativeTransfer();
        graduationRefund = msg.value;
    }

    function executionVersion() public pure virtual returns (uint32) {
        return 1;
    }

    function executionEngine() external view returns (address) {
        return address(this);
    }

    function executionEngineRuntimeHash() external view returns (bytes32) {
        return address(this).codehash;
    }

    /// @notice Preserves immutable policy and asset identity across the reviewed transition.
    function migrationCommitment() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                factory,
                token,
                creator,
                treasury,
                treasuryShareBps,
                operatingRecipient,
                futureReserveRecipient,
                graduationEngine,
                revenueLedger,
                projectRegistry,
                totalSupply,
                virtualToken,
                graduationSold,
                economicRules
            )
        );
    }

    /// @dev Only the bound factory can move tracked assets to the candidate it deployed itself.
    function migrateAssets(address payable nextCurve, bytes32 expectedRuntimeHash)
        external
        nonReentrant
        returns (uint256 soldAmount, uint256 backing, uint256 inventory)
    {
        if (msg.sender != factory) revert UnauthorizedMigration();
        if (graduated || !active) revert CurveClosed();
        if (nextCurve.code.length == 0 || nextCurve.codehash != expectedRuntimeHash) {
            revert InvalidMigrationSettlement();
        }
        RMTLaunchBondingCurveV1 next = RMTLaunchBondingCurveV1(nextCurve);
        if (
            next.migrationSource() != address(this) || next.executionVersion() != executionVersion() + 1
                || next.migrationCommitment() != migrationCommitment() || next.active()
        ) revert InvalidMigrationSettlement();
        soldAmount = sold;
        backing = backingReserve;
        inventory = totalSupply - soldAmount;
        uint256 sourceNative = address(this).balance;
        uint256 destinationNative = nextCurve.balance;
        uint256 sourceTokens = token.balanceOf(address(this));
        uint256 destinationTokens = token.balanceOf(nextCurve);
        if (sourceNative < backing || sourceTokens < inventory) {
            revert InvalidMigrationSettlement();
        }
        active = false;
        migratedTo = nextCurve;
        backingReserve = 0;
        // The only admitted token is the factory's fixed-supply ERC-20, whose transfer is exact.
        token.safeTransfer(nextCurve, inventory);
        // The successor remains closed throughout the ledger interaction.
        revenueLedger.moveAccrual(nextCurve);
        next.acceptMigration{value: backing}(soldAmount, backing, inventory);
        if (
            address(this).balance != sourceNative - backing || nextCurve.balance != destinationNative + backing
                || token.balanceOf(address(this)) != sourceTokens - inventory
                || token.balanceOf(nextCurve) != destinationTokens + inventory
                || revenueLedger.activeCurve() != nextCurve || !next.active() || next.sold() != soldAmount
                || next.backingReserve() != backing
        ) revert InvalidMigrationSettlement();
    }

    function acceptMigration(uint256 soldAmount, uint256 backing, uint256 inventory) external payable nonReentrant {
        if (msg.sender != migrationSource) revert UnauthorizedMigration();
        if (
            active || migratedTo != address(0) || graduated || soldAmount > graduationSold
                || inventory != totalSupply - soldAmount || msg.value != backing
                || backing != RMTLaunchCurveMathV1.requiredBacking(virtualToken, soldAmount)
                || token.balanceOf(address(this)) < inventory
                || RMTLaunchBondingCurveV1(payable(msg.sender)).migratedTo() != address(this)
                || revenueLedger.activeCurve() != address(this)
        ) revert InvalidMigrationSettlement();
        sold = soldAmount;
        backingReserve = backing;
        active = true;
    }

    function _quote(uint256 input, bool isBuy)
        private
        view
        returns (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund)
    {
        IRMTLaunchCurveExecution.QuoteState memory state =
            IRMTLaunchCurveExecution.QuoteState(sold, backingReserve, virtualToken, graduationSold, input, isBuy);
        return RMTLaunchCurveMathV1.quote(state);
    }

    /// @notice The gross budget includes a fee. Overshoot and integer residue are refundable.
    function quoteBuy(uint256 grossBudget)
        public
        view
        returns (uint256 tokensOut, uint256 grossUsed, uint256 fee, uint256 refund)
    {
        if (graduated || !active) return (0, 0, 0, grossBudget);
        return _quote(grossBudget, true);
    }

    function quoteSell(uint256 tokenIn) public view returns (uint256 ethOut, uint256 grossReleased, uint256 fee) {
        if (graduated || !active) return (0, 0, 0);
        (ethOut, grossReleased, fee,) = _quote(tokenIn, false);
    }

    function buy(uint256 minimumTokenOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        BuyFill memory fill = _recordBuy(minimumTokenOut, deadline);
        _settleBuy(fill);
        _emitBuy(fill);
        return fill.tokensOut;
    }

    /// @notice Explicitly commits the fill and graduation together. A failed graduation reverts the fill.
    function buyAndGraduate(uint256 minimumTokenOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        BuyFill memory fill = _recordBuy(minimumTokenOut, deadline);
        // Capture the fill's terminal curve reserves before graduation clears them.
        _emitBuy(fill);
        _graduate(deadline);
        // Pay the buyer only after the position, backing and curve phase are finalized.
        _settleBuy(fill);
        return fill.tokensOut;
    }

    function _recordBuy(uint256 minimumTokenOut, uint256 deadline) private returns (BuyFill memory fill) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (graduated || !active) revert CurveClosed();
        if (minimumTokenOut == 0) revert InvalidTrade();
        (fill.tokensOut, fill.grossUsed, fill.fee, fill.refund) = quoteBuy(msg.value);
        if (fill.tokensOut < minimumTokenOut) revert SlippageExceeded();
        sold += fill.tokensOut;
        backingReserve += fill.grossUsed - fill.fee;
    }

    function _settleBuy(BuyFill memory fill) private {
        token.safeTransfer(msg.sender, fill.tokensOut);
        revenueLedger.accrue{value: fill.fee}();
        if (fill.refund != 0) _pay(msg.sender, fill.refund);
    }

    function _emitBuy(BuyFill memory fill) private {
        emit CurveTrade(msg.sender, true, fill.tokensOut, fill.grossUsed, fill.fee, fill.refund, sold, backingReserve);
    }

    function sell(uint256 amountIn, uint256 minimumEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (graduated || !active) revert CurveClosed();
        if (minimumEthOut == 0) revert InvalidTrade();
        uint256 grossReleased;
        uint256 fee;
        (ethOut, grossReleased, fee) = quoteSell(amountIn);
        if (ethOut < minimumEthOut) revert SlippageExceeded();
        sold -= amountIn;
        backingReserve -= grossReleased;
        token.safeTransferFrom(msg.sender, address(this), amountIn);
        revenueLedger.accrue{value: fee}();
        _pay(msg.sender, ethOut);
        emit CurveTrade(msg.sender, false, amountIn, grossReleased, fee, 0, sold, backingReserve);
    }

    /// @notice Anyone can attempt graduation at the threshold. A failed attempt leaves curve sells open.
    function graduate(uint256 deadline) external nonReentrant {
        _graduate(deadline);
    }

    function _graduate(uint256 deadline) private {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (graduated || !active) revert CurveClosed();
        uint256 backing = backingReserve;
        if (sold != graduationSold || backing != GRADUATION_BACKING) revert GraduationNotReady();
        uint256 inventory = totalSupply - sold;
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));
        // Seal curve trades and clear backing before interacting with the v4 engine.
        // Any funding or settlement revert atomically restores both fields.
        graduated = true;
        backingReserve = 0;
        _approveGraduation(inventory);
        receivingGraduationRefund = true;
        (bytes32 id, uint256 position, uint256 nativeUsed, uint256 tokenUsed) = graduationEngine.graduate{
            value: backing
        }(
            address(token), backing, inventory, virtualToken - sold, VIRTUAL_ETH + backing, deadline
        );
        receivingGraduationRefund = false;
        _approveGraduation(0);
        if (
            id == bytes32(0) || position == 0 || nativeUsed == 0 || tokenUsed == 0 || nativeUsed > backing
                || tokenUsed > inventory || graduationRefund != backing - nativeUsed
                || address(this).balance != nativeBefore - nativeUsed
                || token.balanceOf(address(this)) != tokenBefore - tokenUsed
        ) revert InvalidGraduationSettlement();
        poolId = id;
        positionTokenId = position;
        nativeDust = backing - nativeUsed;
        tokenDust = inventory - tokenUsed;
        emit CurveGraduated(id, position, nativeUsed, tokenUsed, nativeDust, tokenDust);
    }

    function _approveGraduation(uint256 amount) private {
        // The factory's immutable ERC-20 exposes checked, exact, boolean-returning approvals.
        address spender = address(graduationEngine);
        if (!token.approve(spender, amount) || token.allowance(address(this), spender) != amount) {
            revert InvalidGraduationSettlement();
        }
    }

    function _pay(address recipient, uint256 amount) private {
        (bool sent,) = payable(recipient).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}
