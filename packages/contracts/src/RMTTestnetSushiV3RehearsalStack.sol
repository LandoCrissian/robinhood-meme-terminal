// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTConsentLiquidityMigrator} from "./RMTConsentLiquidityMigrator.sol";
import {RMTConsentLiquiditySession} from "./RMTConsentLiquiditySession.sol";
import {RMTV6Governance} from "./RMTV6Governance.sol";
import {ISushiV3Factory} from "./interfaces/ISushiV3Factory.sol";
import {ISushiV3Pool} from "./interfaces/ISushiV3Pool.sol";
import {ISushiV3PositionManager} from "./interfaces/ISushiV3PositionManager.sol";

/// @dev Shared constructor guard for the deliberately non-official, no-value rehearsal venue.
abstract contract RMTTestnetSushiV3RehearsalChainGuard {
    uint256 public constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

    error WrongChain(uint256 actualChainId);

    constructor() {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
    }
}

/// @notice Fixed-supply, valueless rehearsal token. This is not WETH and has no mint authority.
contract RMTTestnetSushiV3RehearsalToken is ERC20, RMTTestnetSushiV3RehearsalChainGuard {
    address public immutable initialRecipient;

    error InvalidRecipient();

    constructor(string memory name_, string memory symbol_, address recipient_, uint256 fixedSupply_)
        ERC20(name_, symbol_)
    {
        if (recipient_ == address(0) || fixedSupply_ == 0) revert InvalidRecipient();
        initialRecipient = recipient_;
        _mint(recipient_, fixedSupply_);
    }
}

/// @notice Immutable token sink used only to rehearse the balance effects of a Sushi V3 mint.
/// @dev This is not an official Sushi pool. It cannot swap, withdraw, upgrade, sweep, or receive native currency.
contract RMTTestnetSushiV3RehearsalPool is ISushiV3Pool, RMTTestnetSushiV3RehearsalChainGuard {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    error InvalidConfiguration();

    constructor(address factory_, address token0_, address token1_, uint24 fee_, int24 tickSpacing_) {
        if (
            factory_ == address(0) || token0_ == address(0) || token1_ == address(0) || token0_ >= token1_
                || fee_ != 3_000 || tickSpacing_ != 60
        ) revert InvalidConfiguration();

        factory = factory_;
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }
}

/// @notice One-pool, non-admin factory compatible with the Sushi V3 reads used by the consent router.
/// @dev This is a local Robinhood Chain testnet rehearsal, not a Sushi deployment or endorsement.
contract RMTTestnetSushiV3RehearsalFactory is ISushiV3Factory, RMTTestnetSushiV3RehearsalChainGuard {
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;

    address public immutable token0;
    address public immutable token1;
    RMTTestnetSushiV3RehearsalPool public immutable pool;

    error InvalidConfiguration();

    constructor(address tokenA, address tokenB) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidConfiguration();
        (address sorted0, address sorted1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        token0 = sorted0;
        token1 = sorted1;
        pool = new RMTTestnetSushiV3RehearsalPool(address(this), sorted0, sorted1, POOL_FEE, TICK_SPACING);
    }

    function getPool(address tokenA, address tokenB, uint24 fee_) external view returns (address) {
        bool correctPair = (tokenA == token0 && tokenB == token1) || (tokenA == token1 && tokenB == token0);
        return correctPair && fee_ == POOL_FEE ? address(pool) : address(0);
    }

    function feeAmountTickSpacing(uint24 fee_) external pure returns (int24) {
        return fee_ == POOL_FEE ? TICK_SPACING : int24(0);
    }
}

/// @notice Minimal, non-admin ERC-721 enumerable position manager for no-value ABI rehearsal only.
/// @dev It deliberately implements only the reads and mint shape consumed by RMT. It is not a V3 AMM,
///      performs no pricing, and transfers the exact desired token amounts into its immutable sink pool.
contract RMTTestnetSushiV3RehearsalPositionManager is
    ERC721Enumerable,
    ReentrancyGuard,
    RMTTestnetSushiV3RehearsalChainGuard
{
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    int24 public constant MIN_TICK = -887_272;
    int24 public constant MAX_TICK = 887_272;

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    address public immutable factory;
    address public immutable WETH9;
    address public immutable pool;
    address public immutable token0;
    address public immutable token1;
    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Position position) private _positions;

    error InvalidConfiguration();
    error InvalidMint();

    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    constructor(address factory_, address weth_, address pool_)
        ERC721("RMT No-Value Sushi V3 Rehearsal Position", "RMT-RH-TLP")
    {
        if (factory_ == address(0) || weth_ == address(0) || pool_ == address(0)) {
            revert InvalidConfiguration();
        }

        ISushiV3Pool boundPool = ISushiV3Pool(pool_);
        address token0_ = boundPool.token0();
        address token1_ = boundPool.token1();
        if (
            token0_ == address(0) || token1_ == address(0) || token0_ >= token1_ || boundPool.factory() != factory_
                || boundPool.fee() != POOL_FEE || boundPool.tickSpacing() != TICK_SPACING
                || ISushiV3Factory(factory_).getPool(token0_, token1_, POOL_FEE) != pool_
                || (weth_ != token0_ && weth_ != token1_)
        ) revert InvalidConfiguration();

        factory = factory_;
        WETH9 = weth_;
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
    }

    function mint(MintParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        if (block.chainid != ROBINHOOD_TESTNET_CHAIN_ID || msg.value != 0) revert InvalidMint();
        if (
            params.token0 != token0 || params.token1 != token1 || params.fee != POOL_FEE
                || params.recipient == address(0) || params.deadline < block.timestamp || params.tickLower < MIN_TICK
                || params.tickUpper > MAX_TICK || params.tickLower >= params.tickUpper
                || params.tickLower % TICK_SPACING != 0 || params.tickUpper % TICK_SPACING != 0
                || params.amount0Desired == 0 || params.amount1Desired == 0 || params.amount0Min > params.amount0Desired
                || params.amount1Min > params.amount1Desired
        ) revert InvalidMint();

        uint256 rawLiquidity =
            params.amount0Desired < params.amount1Desired ? params.amount0Desired : params.amount1Desired;
        if (rawLiquidity == 0 || rawLiquidity > type(uint128).max) revert InvalidMint();

        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        liquidity = uint128(rawLiquidity);
        IERC20(token0).safeTransferFrom(msg.sender, pool, amount0);
        IERC20(token1).safeTransferFrom(msg.sender, pool, amount1);

        tokenId = _nextTokenId++;
        _positions[tokenId] = Position({
            token0: token0,
            token1: token1,
            fee: POOL_FEE,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity
        });
        _mint(params.recipient, tokenId);
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address positionToken0,
            address positionToken1,
            uint24 positionFee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        _requireOwned(tokenId);
        Position memory position = _positions[tokenId];
        return (
            0,
            getApproved(tokenId),
            position.token0,
            position.token1,
            position.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            0,
            0,
            0,
            0
        );
    }
}

/// @notice Deterministic Robinhood-testnet-only deployment of an isolated, no-value rehearsal venue.
/// @dev The explicit operator is the governance signer and sole initial test-token recipient. This is
///      intentionally separate from the atomic session/router deployer so both initcodes remain below
///      EIP-3860's 49,152-byte limit. It is not an official Sushi or Robinhood deployment.
contract RMTTestnetSushiV3RehearsalVenue is RMTTestnetSushiV3RehearsalChainGuard {
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    uint256 public constant PAIRED_TOKEN_FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 public constant WETH_FIXED_SUPPLY = 1_000_000 ether;
    uint64 public constant GOVERNANCE_DELAY = 1 days;
    uint64 public constant GOVERNANCE_WINDOW = 7 days;

    struct VenueManifest {
        uint256 chainId;
        address operator;
        address governance;
        address pairedToken;
        address weth;
        address factory;
        address pool;
        address positionManager;
        uint24 poolFee;
        int24 tickSpacing;
        uint256 pairedTokenFixedSupply;
        uint256 wethFixedSupply;
        bytes32 pairedTokenCodeHash;
        bytes32 wethCodeHash;
        bytes32 governanceCodeHash;
        bytes32 factoryCodeHash;
        bytes32 poolCodeHash;
        bytes32 positionManagerCodeHash;
        bytes32 venueCodeHash;
    }

    address public immutable operator;
    RMTV6Governance public immutable governance;
    RMTTestnetSushiV3RehearsalToken public immutable pairedToken;
    RMTTestnetSushiV3RehearsalToken public immutable weth;
    RMTTestnetSushiV3RehearsalFactory public immutable factory;
    RMTTestnetSushiV3RehearsalPool public immutable pool;
    RMTTestnetSushiV3RehearsalPositionManager public immutable positionManager;

    bytes32 public immutable pairedTokenCodeHash;
    bytes32 public immutable wethCodeHash;
    bytes32 public immutable governanceCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable poolCodeHash;
    bytes32 public immutable positionManagerCodeHash;

    error InvalidOperator();

    event RehearsalVenueDeployed(
        address indexed operator,
        address indexed factory,
        address indexed positionManager,
        address governance,
        address pairedToken,
        address weth,
        address pool,
        uint24 poolFee,
        int24 tickSpacing,
        bytes32 pairedTokenCodeHash,
        bytes32 wethCodeHash,
        bytes32 governanceCodeHash,
        bytes32 factoryCodeHash,
        bytes32 poolCodeHash,
        bytes32 positionManagerCodeHash
    );

    constructor(address operator_) {
        if (operator_ == address(0)) revert InvalidOperator();
        operator = operator_;

        RMTTestnetSushiV3RehearsalToken pairedToken_ = new RMTTestnetSushiV3RehearsalToken(
            "RMT Rehearsal Paired Token (No Value)", "tRMT-NV", operator_, PAIRED_TOKEN_FIXED_SUPPLY
        );
        RMTTestnetSushiV3RehearsalToken weth_ = new RMTTestnetSushiV3RehearsalToken(
            "RMT Rehearsal WETH (No Value)", "tWETH-NV", operator_, WETH_FIXED_SUPPLY
        );
        RMTTestnetSushiV3RehearsalFactory factory_ =
            new RMTTestnetSushiV3RehearsalFactory(address(pairedToken_), address(weth_));
        RMTTestnetSushiV3RehearsalPool pool_ = factory_.pool();
        RMTTestnetSushiV3RehearsalPositionManager positionManager_ =
            new RMTTestnetSushiV3RehearsalPositionManager(address(factory_), address(weth_), address(pool_));
        RMTV6Governance governance_ = new RMTV6Governance(operator_, GOVERNANCE_DELAY, GOVERNANCE_WINDOW);

        governance = governance_;
        pairedToken = pairedToken_;
        weth = weth_;
        factory = factory_;
        pool = pool_;
        positionManager = positionManager_;
        pairedTokenCodeHash = address(pairedToken_).codehash;
        wethCodeHash = address(weth_).codehash;
        governanceCodeHash = address(governance_).codehash;
        factoryCodeHash = address(factory_).codehash;
        poolCodeHash = address(pool_).codehash;
        positionManagerCodeHash = address(positionManager_).codehash;

        emit RehearsalVenueDeployed(
            operator_,
            address(factory_),
            address(positionManager_),
            address(governance_),
            address(pairedToken_),
            address(weth_),
            address(pool_),
            POOL_FEE,
            TICK_SPACING,
            address(pairedToken_).codehash,
            address(weth_).codehash,
            address(governance_).codehash,
            address(factory_).codehash,
            address(pool_).codehash,
            address(positionManager_).codehash
        );
    }

    function manifest() external view returns (VenueManifest memory) {
        return VenueManifest({
            chainId: ROBINHOOD_TESTNET_CHAIN_ID,
            operator: operator,
            governance: address(governance),
            pairedToken: address(pairedToken),
            weth: address(weth),
            factory: address(factory),
            pool: address(pool),
            positionManager: address(positionManager),
            poolFee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            pairedTokenFixedSupply: PAIRED_TOKEN_FIXED_SUPPLY,
            wethFixedSupply: WETH_FIXED_SUPPLY,
            pairedTokenCodeHash: pairedTokenCodeHash,
            wethCodeHash: wethCodeHash,
            governanceCodeHash: governanceCodeHash,
            factoryCodeHash: factoryCodeHash,
            poolCodeHash: poolCodeHash,
            positionManagerCodeHash: positionManagerCodeHash,
            venueCodeHash: address(this).codehash
        });
    }

    /// @notice Live runtime hash for independent post-deployment verification.
    function runtimeCodeHash() external view returns (bytes32) {
        return address(this).codehash;
    }
}

/// @notice One-shot atomic deployment of a session and initially paused consent migrator.
/// @dev It consumes only one fixed-policy rehearsal venue for the same explicit operator. The venue
///      and this stack are separate creation payloads solely to obey the EIP-3860 initcode limit.
///      They can be submitted to an external canonical CREATE2 deployer because operator identity is
///      passed explicitly rather than inferred from msg.sender.
contract RMTTestnetSushiV3ConsentStack is RMTTestnetSushiV3RehearsalChainGuard {
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    uint256 public constant PAIRED_TOKEN_FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 public constant WETH_FIXED_SUPPLY = 1_000_000 ether;
    uint64 public constant GOVERNANCE_DELAY = 1 days;
    uint64 public constant GOVERNANCE_WINDOW = 7 days;
    bytes32 public constant TERMS_DOCUMENT_HASH = 0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57;

    struct Manifest {
        uint256 chainId;
        address operator;
        address venue;
        address governance;
        address guardian;
        address pairedToken;
        address weth;
        address factory;
        address pool;
        address positionManager;
        address session;
        address migrator;
        uint24 poolFee;
        int24 tickSpacing;
        uint256 pairedTokenFixedSupply;
        uint256 wethFixedSupply;
        bytes32 pairedTokenCodeHash;
        bytes32 wethCodeHash;
        bytes32 venueCodeHash;
        bytes32 governanceCodeHash;
        bytes32 factoryCodeHash;
        bytes32 poolCodeHash;
        bytes32 positionManagerCodeHash;
        bytes32 sessionCodeHash;
        bytes32 migratorCodeHash;
        bytes32 consentStackCodeHash;
        bytes32 configurationHash;
        bytes32 termsDocumentHash;
        bytes32 migrationTermsHash;
    }

    address public immutable operator;
    RMTTestnetSushiV3RehearsalVenue public immutable venue;
    RMTV6Governance public immutable governance;
    RMTTestnetSushiV3RehearsalToken public immutable pairedToken;
    RMTTestnetSushiV3RehearsalToken public immutable weth;
    RMTTestnetSushiV3RehearsalFactory public immutable factory;
    RMTTestnetSushiV3RehearsalPool public immutable pool;
    RMTTestnetSushiV3RehearsalPositionManager public immutable positionManager;
    RMTConsentLiquiditySession public immutable session;
    RMTConsentLiquidityMigrator public immutable migrator;

    bytes32 public immutable pairedTokenCodeHash;
    bytes32 public immutable wethCodeHash;
    bytes32 public immutable venueCodeHash;
    bytes32 public immutable governanceCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable poolCodeHash;
    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable sessionCodeHash;
    bytes32 public immutable migratorCodeHash;
    bytes32 public immutable configurationHash;
    bytes32 public immutable migrationTermsHash;

    error InvalidConfiguration();
    error DeploymentVerificationFailed();

    event ConsentStackDeployed(
        address indexed operator,
        address indexed migrator,
        address indexed session,
        address venue,
        address governance,
        address pairedToken,
        address weth,
        address factory,
        address pool,
        address positionManager,
        uint24 poolFee,
        int24 tickSpacing,
        bytes32 sessionCodeHash,
        bytes32 configurationHash,
        bytes32 migrationTermsHash
    );

    constructor(address operator_, RMTTestnetSushiV3RehearsalVenue venue_) {
        if (operator_ == address(0) || address(venue_).code.length == 0 || venue_.operator() != operator_) {
            revert InvalidConfiguration();
        }

        RMTV6Governance governance_ = venue_.governance();
        RMTTestnetSushiV3RehearsalToken pairedToken_ = venue_.pairedToken();
        RMTTestnetSushiV3RehearsalToken weth_ = venue_.weth();
        RMTTestnetSushiV3RehearsalFactory factory_ = venue_.factory();
        RMTTestnetSushiV3RehearsalPool pool_ = venue_.pool();
        RMTTestnetSushiV3RehearsalPositionManager positionManager_ = venue_.positionManager();
        address token0_ = address(pairedToken_) < address(weth_) ? address(pairedToken_) : address(weth_);
        address token1_ = address(pairedToken_) < address(weth_) ? address(weth_) : address(pairedToken_);

        if (
            !governance_.isSigner(operator_) || governance_.signerCount() != 1 || governance_.threshold() != 1
                || governance_.executionDelay() != GOVERNANCE_DELAY
                || governance_.executionWindow() != GOVERNANCE_WINDOW
                || pairedToken_.totalSupply() != PAIRED_TOKEN_FIXED_SUPPLY || weth_.totalSupply() != WETH_FIXED_SUPPLY
                || factory_.POOL_FEE() != POOL_FEE || factory_.TICK_SPACING() != TICK_SPACING
                || factory_.pool() != pool_ || factory_.getPool(token0_, token1_, POOL_FEE) != address(pool_)
                || factory_.feeAmountTickSpacing(POOL_FEE) != TICK_SPACING || pool_.factory() != address(factory_)
                || pool_.token0() != token0_ || pool_.token1() != token1_ || pool_.fee() != POOL_FEE
                || pool_.tickSpacing() != TICK_SPACING || positionManager_.factory() != address(factory_)
                || positionManager_.WETH9() != address(weth_) || positionManager_.pool() != address(pool_)
                || positionManager_.token0() != token0_ || positionManager_.token1() != token1_
                || venue_.pairedTokenCodeHash() != address(pairedToken_).codehash
                || venue_.wethCodeHash() != address(weth_).codehash
                || venue_.governanceCodeHash() != address(governance_).codehash
                || venue_.factoryCodeHash() != address(factory_).codehash
                || venue_.poolCodeHash() != address(pool_).codehash
                || venue_.positionManagerCodeHash() != address(positionManager_).codehash
        ) revert InvalidConfiguration();

        address expectedSession = _computeCreateAddress(address(this), 1);
        address expectedMigrator = _computeCreateAddress(address(this), 2);
        RMTConsentLiquiditySession session_ = new RMTConsentLiquiditySession(
            expectedMigrator,
            IERC20(address(pairedToken_)),
            IERC20(address(weth_)),
            ISushiV3PositionManager(address(positionManager_)),
            POOL_FEE
        );
        bytes32 sessionCodeHash_ = address(session_).codehash;
        RMTConsentLiquidityMigrator.Configuration memory config = RMTConsentLiquidityMigrator.Configuration({
            destinationChainId: ROBINHOOD_TESTNET_CHAIN_ID,
            governance: address(governance_),
            guardian: operator_,
            weth: IERC20(address(weth_)),
            pairedToken: IERC20(address(pairedToken_)),
            positionManager: ISushiV3PositionManager(address(positionManager_)),
            factory: ISushiV3Factory(address(factory_)),
            pool: ISushiV3Pool(address(pool_)),
            session: session_,
            poolFee: POOL_FEE,
            positionManagerCodeHash: address(positionManager_).codehash,
            factoryCodeHash: address(factory_).codehash,
            poolCodeHash: address(pool_).codehash,
            sessionCodeHash: sessionCodeHash_,
            wethCodeHash: address(weth_).codehash,
            pairedTokenCodeHash: address(pairedToken_).codehash,
            termsDocumentHash: TERMS_DOCUMENT_HASH
        });
        RMTConsentLiquidityMigrator migrator_ = new RMTConsentLiquidityMigrator(config);
        if (
            address(session_) != expectedSession || address(migrator_) != expectedMigrator
                || session_.router() != address(migrator_) || address(migrator_.liquiditySession()) != address(session_)
                || !migrator_.paused() || migrator_.governance() != address(governance_)
                || migrator_.guardian() != operator_
        ) revert DeploymentVerificationFailed();

        operator = operator_;
        venue = venue_;
        governance = governance_;
        pairedToken = pairedToken_;
        weth = weth_;
        factory = factory_;
        pool = pool_;
        positionManager = positionManager_;
        session = session_;
        migrator = migrator_;
        pairedTokenCodeHash = address(pairedToken_).codehash;
        wethCodeHash = address(weth_).codehash;
        venueCodeHash = address(venue_).codehash;
        governanceCodeHash = address(governance_).codehash;
        factoryCodeHash = address(factory_).codehash;
        poolCodeHash = address(pool_).codehash;
        positionManagerCodeHash = address(positionManager_).codehash;
        sessionCodeHash = sessionCodeHash_;
        migratorCodeHash = address(migrator_).codehash;
        configurationHash = migrator_.configurationHash();
        migrationTermsHash = migrator_.migrationTermsHash();

        emit ConsentStackDeployed(
            operator_,
            address(migrator_),
            address(session_),
            address(venue_),
            address(governance_),
            address(pairedToken_),
            address(weth_),
            address(factory_),
            address(pool_),
            address(positionManager_),
            POOL_FEE,
            TICK_SPACING,
            sessionCodeHash_,
            migrator_.configurationHash(),
            migrator_.migrationTermsHash()
        );
    }

    function manifest() external view returns (Manifest memory) {
        return Manifest({
            chainId: ROBINHOOD_TESTNET_CHAIN_ID,
            operator: operator,
            venue: address(venue),
            governance: address(governance),
            guardian: operator,
            pairedToken: address(pairedToken),
            weth: address(weth),
            factory: address(factory),
            pool: address(pool),
            positionManager: address(positionManager),
            session: address(session),
            migrator: address(migrator),
            poolFee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            pairedTokenFixedSupply: PAIRED_TOKEN_FIXED_SUPPLY,
            wethFixedSupply: WETH_FIXED_SUPPLY,
            pairedTokenCodeHash: pairedTokenCodeHash,
            wethCodeHash: wethCodeHash,
            venueCodeHash: venueCodeHash,
            governanceCodeHash: governanceCodeHash,
            factoryCodeHash: factoryCodeHash,
            poolCodeHash: poolCodeHash,
            positionManagerCodeHash: positionManagerCodeHash,
            sessionCodeHash: sessionCodeHash,
            migratorCodeHash: migratorCodeHash,
            consentStackCodeHash: address(this).codehash,
            configurationHash: configurationHash,
            termsDocumentHash: TERMS_DOCUMENT_HASH,
            migrationTermsHash: migrationTermsHash
        });
    }

    /// @notice Live runtime hash for independent post-deployment verification.
    function runtimeCodeHash() external view returns (bytes32) {
        return address(this).codehash;
    }

    function _computeCreateAddress(address deployer, uint8 nonce) private pure returns (address) {
        // Both fixed child nonces are 1..127, whose canonical RLP is d6 94 <deployer> <nonce>.
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(nonce))))));
    }
}
