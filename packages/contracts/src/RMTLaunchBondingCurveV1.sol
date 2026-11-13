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
    uint256 private constant ADAPTER_GAS = 30_000;

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

    uint256 public sold;
    uint256 public backingReserve;
    bool public graduated;
    bytes32 public poolId;
    uint256 public positionTokenId;
    uint256 public nativeDust;
    uint256 public tokenDust;
    address public executionEngine;
    uint32 public executionVersion = 1;
    bytes32 public executionEngineRuntimeHash;
    bool private receivingGraduationRefund;

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
    error IncompatibleExecutionEngine();

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
    event CurveExecutionMigrated(
        address indexed previousEngine, address indexed engine, uint32 version, bytes32 runtimeHash
    );

    constructor(
        IERC20 token_,
        address creator_,
        address treasury_,
        uint16 treasuryShareBps_,
        address operatingRecipient_,
        address futureReserveRecipient_,
        IRMTV4CurveGraduationV1 graduationEngine_,
        address projectRegistry_
    ) {
        factory = msg.sender;
        projectRegistry = projectRegistry_;
        executionEngine = address(this);
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
        revenueLedger = new RMTLaunchCurveRevenueLedgerV1(
            creator_, treasury_, treasuryShareBps_, operatingRecipient_, futureReserveRecipient_
        );
    }

    receive() external payable {
        if (!receivingGraduationRefund || msg.sender != address(graduationEngine)) revert UnauthorizedNativeTransfer();
    }

    /// @notice Updates only the stateless execution adapter after registry authorization.
    function migrateExecution(address engine, bytes32 expectedRuntimeHash) external nonReentrant {
        if (msg.sender != projectRegistry) revert UnauthorizedMigration();
        if (graduated) revert CurveClosed();
        if (engine == executionEngine || engine.code.length == 0 || engine.codehash != expectedRuntimeHash) {
            revert IncompatibleExecutionEngine();
        }
        uint32 version = executionVersion + 1;
        if (
            _readAdapterWord(engine, IRMTLaunchCurveExecution.engineVersion.selector) != bytes32(uint256(version))
                || _readAdapterWord(engine, IRMTLaunchCurveExecution.economicRules.selector) != economicRules
        ) revert IncompatibleExecutionEngine();
        IRMTLaunchCurveExecution.QuoteState memory sample =
            IRMTLaunchCurveExecution.QuoteState(0, 0, virtualToken, graduationSold, GRADUATION_BACKING * 2, true);
        if (!_matchesQuote(engine, sample)) revert IncompatibleExecutionEngine();
        sample = IRMTLaunchCurveExecution.QuoteState(
            graduationSold, GRADUATION_BACKING, virtualToken, graduationSold, graduationSold, false
        );
        if (!_matchesQuote(engine, sample)) revert IncompatibleExecutionEngine();
        address previous = executionEngine;
        executionEngine = engine;
        executionVersion = version;
        executionEngineRuntimeHash = expectedRuntimeHash;
        emit CurveExecutionMigrated(previous, engine, version, expectedRuntimeHash);
    }

    function _readAdapterWord(address engine, bytes4 selector) private view returns (bytes32 word) {
        bytes memory input = abi.encodeWithSelector(selector);
        uint256 stipend = ADAPTER_GAS;
        assembly ("memory-safe") {
            let ok := staticcall(stipend, engine, add(input, 32), mload(input), 0, 32)
            if and(ok, eq(returndatasize(), 32)) {
                word := mload(0)
            }
        }
    }

    function _matchesQuote(address engine, IRMTLaunchCurveExecution.QuoteState memory state)
        private
        view
        returns (bool)
    {
        (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund) = RMTLaunchCurveMathV1.quote(state);
        (bool available, uint256[4] memory values) = _adapterQuote(engine, state);
        return available && values[0] == amountOut && values[1] == gross && values[2] == fee && values[3] == refund;
    }

    function _adapterQuote(address engine, IRMTLaunchCurveExecution.QuoteState memory state)
        private
        view
        returns (bool available, uint256[4] memory values)
    {
        bytes memory input = abi.encodeCall(IRMTLaunchCurveExecution.quote, (state));
        uint256 stipend = ADAPTER_GAS;
        values = [uint256(0), 0, 0, 0];
        // Bound both forwarded gas and copied return bytes, including on malformed or reverting adapters.
        assembly ("memory-safe") {
            let ok := staticcall(stipend, engine, add(input, 32), mload(input), values, 128)
            available := and(ok, eq(returndatasize(), 128))
        }
    }

    function _quote(uint256 input, bool isBuy)
        private
        view
        returns (uint256 amountOut, uint256 gross, uint256 fee, uint256 refund)
    {
        IRMTLaunchCurveExecution.QuoteState memory state =
            IRMTLaunchCurveExecution.QuoteState(sold, backingReserve, virtualToken, graduationSold, input, isBuy);
        (amountOut, gross, fee, refund) = RMTLaunchCurveMathV1.quote(state);
        address engine = executionEngine;
        if (engine != address(this) && engine.codehash == executionEngineRuntimeHash) {
            (bool available, uint256[4] memory values) = _adapterQuote(engine, state);
            if (available && values[0] == amountOut && values[1] == gross && values[2] == fee && values[3] == refund) {
                return (values[0], values[1], values[2], values[3]);
            }
        }
        // A broken or unavailable adapter cannot block existing holders' exits.
        return (amountOut, gross, fee, refund);
    }

    /// @notice The gross budget includes a fee. Overshoot and integer residue are refundable.
    function quoteBuy(uint256 grossBudget)
        public
        view
        returns (uint256 tokensOut, uint256 grossUsed, uint256 fee, uint256 refund)
    {
        if (graduated) return (0, 0, 0, grossBudget);
        return _quote(grossBudget, true);
    }

    function quoteSell(uint256 tokenIn) public view returns (uint256 ethOut, uint256 grossReleased, uint256 fee) {
        if (graduated) return (0, 0, 0);
        (ethOut, grossReleased, fee,) = _quote(tokenIn, false);
    }

    function buy(uint256 minimumTokenOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        return _buy(minimumTokenOut, deadline);
    }

    /// @notice Explicitly commits the fill and graduation together. A failed graduation reverts the fill.
    function buyAndGraduate(uint256 minimumTokenOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        tokensOut = _buy(minimumTokenOut, deadline);
        _graduate(deadline);
    }

    function _buy(uint256 minimumTokenOut, uint256 deadline) private returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (graduated) revert CurveClosed();
        if (minimumTokenOut == 0) revert InvalidTrade();
        uint256 grossUsed;
        uint256 fee;
        uint256 refund;
        (tokensOut, grossUsed, fee, refund) = quoteBuy(msg.value);
        if (tokensOut < minimumTokenOut) revert SlippageExceeded();
        sold += tokensOut;
        backingReserve += grossUsed - fee;
        token.safeTransfer(msg.sender, tokensOut);
        revenueLedger.accrue{value: fee}();
        if (refund != 0) _pay(msg.sender, refund);
        emit CurveTrade(msg.sender, true, tokensOut, grossUsed, fee, refund, sold, backingReserve);
    }

    function sell(uint256 amountIn, uint256 minimumEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (graduated) revert CurveClosed();
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
        if (graduated) revert CurveClosed();
        uint256 backing = backingReserve;
        if (sold != graduationSold || backing != GRADUATION_BACKING) revert GraduationNotReady();
        uint256 inventory = totalSupply - sold;
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));
        receivingGraduationRefund = true;
        token.forceApprove(address(graduationEngine), inventory);
        (bytes32 id, uint256 position, uint256 nativeUsed, uint256 tokenUsed) = graduationEngine.graduate{
            value: backing
        }(
            address(token), backing, inventory, virtualToken - sold, VIRTUAL_ETH + backing, deadline
        );
        token.forceApprove(address(graduationEngine), 0);
        receivingGraduationRefund = false;
        if (
            id == bytes32(0) || position == 0 || nativeUsed == 0 || tokenUsed == 0 || nativeUsed > backing
                || tokenUsed > inventory || address(this).balance != nativeBefore - nativeUsed
                || token.balanceOf(address(this)) != tokenBefore - tokenUsed
        ) revert InvalidGraduationSettlement();
        graduated = true;
        poolId = id;
        positionTokenId = position;
        backingReserve = 0;
        nativeDust = backing - nativeUsed;
        tokenDust = inventory - tokenUsed;
        emit CurveGraduated(id, position, nativeUsed, tokenUsed, nativeDust, tokenDust);
    }

    function _pay(address recipient, uint256 amount) private {
        (bool sent,) = payable(recipient).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}
