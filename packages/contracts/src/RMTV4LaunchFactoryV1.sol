// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface ILaunchPositionManagerV1 {
    function poolManager() external view returns (IPoolManager);
    function permit2() external view returns (address);
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface ILaunchPermit2V1 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice Standard fixed-supply ERC-20 for a launch. Project metadata is an immutable-by-interface reference.
contract RMTV4LaunchTokenV1 is ERC20 {
    string public projectURI;

    constructor(string memory name_, string memory symbol_, string memory projectURI_, uint256 supply)
        ERC20(name_, symbol_)
    {
        projectURI = projectURI_;
        _mint(msg.sender, supply);
    }
}

/// @notice Local-only draft for atomic, hookless v4 launches and permanent LP custody.
/// @dev No ownership, proxy, administrator, arbitrary calls, NFT transfers, approvals or principal removal.
contract RMTV4LaunchFactoryV1 is ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;

    uint256 public constant CHAIN_ID = 31_337;
    uint24 public constant LP_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    int24 public constant TICK_LOWER = -887_220;
    int24 public constant TICK_UPPER = 887_220;
    uint256 public constant MAX_DEADLINE_WINDOW = 30 minutes;
    uint128 public constant MIN_NATIVE_AMOUNT = 0.001 ether;
    uint128 public constant MAX_NATIVE_AMOUNT = 100 ether;
    uint16 public constant MIN_POOL_ALLOCATION_BPS = 1_000;
    uint16 public constant MAX_POOL_ALLOCATION_BPS = 10_000;

    struct Terms {
        string name;
        string symbol;
        string projectURI;
        bytes32 intentId;
        uint8 supplyPreset;
        uint16 poolAllocationBps;
        uint128 nativeAmount;
        uint256 deadline;
    }

    struct Position {
        address creator;
        uint256 positionTokenId;
        uint128 liquidity;
    }

    IPoolManager public immutable poolManager;
    ILaunchPositionManagerV1 public immutable positionManager;
    ILaunchPermit2V1 public immutable permit2;
    bytes32 public immutable poolManagerRuntimeHash;
    bytes32 public immutable positionManagerRuntimeHash;
    bytes32 public immutable permit2RuntimeHash;

    mapping(address creator => mapping(bytes32 intentId => address token)) public launches;
    mapping(address token => Position position) public positions;

    event LaunchCreated(
        address indexed creator,
        address indexed token,
        bytes32 indexed poolId,
        bytes32 intentId,
        uint256 positionTokenId,
        PoolKey poolKey,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint128 amount0,
        uint128 amount1,
        uint256 totalSupply,
        string name,
        string symbol,
        string projectURI
    );
    event LaunchFeesCollected(address indexed creator, address indexed token, uint256 indexed positionTokenId);

    error WrongChain();
    error RuntimeIdentityMismatch();
    error InvalidTerms();
    error InvalidDeadline();
    error DuplicateIntent();
    error UnverifiedFunding();
    error NativeRefundFailed();
    error UnauthorizedCreator();

    constructor(
        IPoolManager poolManager_,
        ILaunchPositionManagerV1 positionManager_,
        ILaunchPermit2V1 permit2_,
        bytes32 poolManagerRuntimeHash_,
        bytes32 positionManagerRuntimeHash_,
        bytes32 permit2RuntimeHash_
    ) {
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        poolManagerRuntimeHash = poolManagerRuntimeHash_;
        positionManagerRuntimeHash = positionManagerRuntimeHash_;
        permit2RuntimeHash = permit2RuntimeHash_;
        _verifyDependencies();
        if (positionManager_.poolManager() != poolManager_ || positionManager_.permit2() != address(permit2_)) {
            revert RuntimeIdentityMismatch();
        }
    }

    /// @notice Returns the exact amounts and position created by these draft terms, in atomic units.
    /// @dev Currency 0 is native ETH, currency 1 is the new ERC-20. Rounding dust goes to the creator.
    function preview(uint8 supplyPreset, uint16 poolAllocationBps, uint128 nativeAmount)
        public
        pure
        returns (
            uint256 totalSupply,
            uint128 tokenMaximum,
            uint160 sqrtPriceX96,
            uint128 liquidity,
            uint128 amount0,
            uint128 amount1
        )
    {
        if (
            supplyPreset > 2 || poolAllocationBps < MIN_POOL_ALLOCATION_BPS
                || poolAllocationBps > MAX_POOL_ALLOCATION_BPS || nativeAmount < MIN_NATIVE_AMOUNT
                || nativeAmount > MAX_NATIVE_AMOUNT
        ) revert InvalidTerms();

        if (supplyPreset == 0) totalSupply = 1_000_000 ether;
        else if (supplyPreset == 1) totalSupply = 100_000_000 ether;
        else totalSupply = 1_000_000_000 ether;

        tokenMaximum = (totalSupply * poolAllocationBps / 10_000).toUint128();
        sqrtPriceX96 = Math.sqrt(Math.mulDiv(tokenMaximum, 1 << 192, nativeAmount)).toUint160();
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(TICK_LOWER);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(TICK_UPPER);
        if (sqrtPriceX96 <= sqrtLower || sqrtPriceX96 >= sqrtUpper) revert InvalidTerms();

        liquidity =
            LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtLower, sqrtUpper, nativeAmount, tokenMaximum);
        amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidity, true).toUint128();
        amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtPriceX96, liquidity, true).toUint128();
        if (liquidity == 0 || amount0 == 0 || amount1 == 0 || amount0 > nativeAmount || amount1 > tokenMaximum) {
            revert InvalidTerms();
        }
    }

    function launch(Terms calldata terms) external payable nonReentrant returns (address token) {
        _verifyDependencies();
        _verifyDeadline(terms.deadline);
        _verifyTerms(terms);
        if (launches[msg.sender][terms.intentId] != address(0)) revert DuplicateIntent();

        (uint256 totalSupply,, uint160 price, uint128 liquidity, uint128 amount0, uint128 amount1) =
            preview(terms.supplyPreset, terms.poolAllocationBps, terms.nativeAmount);
        bytes32 salt = keccak256(abi.encode(msg.sender, terms.intentId));
        RMTV4LaunchTokenV1 launchToken =
            new RMTV4LaunchTokenV1{salt: salt}(terms.name, terms.symbol, terms.projectURI, totalSupply);
        token = address(launchToken);
        PoolKey memory poolKey = _poolKey(token);
        uint256 positionTokenId = positionManager.nextTokenId();

        // Any settlement failure rolls back these records and the token deployment.
        launches[msg.sender][terms.intentId] = token;
        positions[token] = Position(msg.sender, positionTokenId, liquidity);

        // An already initialized pool fails closed. A new intent selects a different token address.
        int24 initialTick = poolManager.initialize(poolKey, price);
        if (initialTick < TICK_LOWER || initialTick >= TICK_UPPER) revert UnverifiedFunding();
        _fundPosition(launchToken, poolKey, positionTokenId, liquidity, amount0, amount1, terms.deadline);

        if (!launchToken.transfer(msg.sender, totalSupply - amount1)) revert UnverifiedFunding();
        uint256 refund = msg.value - amount0;
        if (refund != 0) {
            (bool paid,) = msg.sender.call{value: refund}("");
            if (!paid) revert NativeRefundFailed();
        }

        emit LaunchCreated(
            msg.sender,
            token,
            PoolId.unwrap(poolKey.toId()),
            terms.intentId,
            positionTokenId,
            poolKey,
            price,
            TICK_LOWER,
            TICK_UPPER,
            liquidity,
            amount0,
            amount1,
            totalSupply,
            terms.name,
            terms.symbol,
            terms.projectURI
        );
    }

    function collectFees(address token, uint256 deadline) external nonReentrant {
        _verifyDependencies();
        _verifyDeadline(deadline);
        Position memory position = positions[token];
        if (msg.sender != position.creator) revert UnauthorizedCreator();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(position.positionTokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(0)), Currency.wrap(token), position.creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);
        _verifyCustody(position.positionTokenId, position.liquidity);
        emit LaunchFeesCollected(position.creator, token, position.positionTokenId);
    }

    function _fundPosition(
        RMTV4LaunchTokenV1 token,
        PoolKey memory poolKey,
        uint256 positionTokenId,
        uint128 liquidity,
        uint128 amount0,
        uint128 amount1,
        uint256 deadline
    ) private {
        if (!token.approve(address(permit2), amount1)) revert UnverifiedFunding();
        permit2.approve(address(token), address(positionManager), amount1, deadline.toUint48());

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(poolKey, TICK_LOWER, TICK_UPPER, liquidity, amount0, amount1, address(this), bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        uint256 nativeBefore = address(poolManager).balance;
        positionManager.modifyLiquidities{value: amount0}(abi.encode(actions, params), deadline);

        permit2.approve(address(token), address(positionManager), 0, 0);
        if (!token.approve(address(permit2), 0)) revert UnverifiedFunding();
        if (address(poolManager).balance != nativeBefore + amount0 || token.balanceOf(address(poolManager)) != amount1)
        {
            revert UnverifiedFunding();
        }
        _verifyCustody(positionTokenId, liquidity);
    }

    function _verifyCustody(uint256 positionTokenId, uint128 liquidity) private view {
        if (
            positionManager.ownerOf(positionTokenId) != address(this)
                || positionManager.getPositionLiquidity(positionTokenId) != liquidity
        ) revert UnverifiedFunding();
    }

    function _verifyTerms(Terms calldata terms) private view {
        uint256 nameLength = bytes(terms.name).length;
        uint256 symbolLength = bytes(terms.symbol).length;
        if (
            nameLength == 0 || nameLength > 64 || symbolLength == 0 || symbolLength > 12
                || bytes(terms.projectURI).length > 512 || terms.intentId == bytes32(0)
                || msg.value != terms.nativeAmount
        ) revert InvalidTerms();
        for (uint256 i; i < symbolLength; ++i) {
            bytes1 character = bytes(terms.symbol)[i];
            if (!(character >= "A" && character <= "Z") && !(character >= "0" && character <= "9")) {
                revert InvalidTerms();
            }
        }
    }

    function _verifyDeadline(uint256 deadline) private view {
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert InvalidDeadline();
    }

    function _verifyDependencies() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            address(poolManager).code.length == 0 || address(poolManager).codehash != poolManagerRuntimeHash
                || address(positionManager).code.length == 0
                || address(positionManager).codehash != positionManagerRuntimeHash || address(permit2).code.length == 0
                || address(permit2).codehash != permit2RuntimeHash
        ) revert RuntimeIdentityMismatch();
    }

    function _poolKey(address token) private pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), LP_FEE, TICK_SPACING, IHooks(address(0)));
    }
}
