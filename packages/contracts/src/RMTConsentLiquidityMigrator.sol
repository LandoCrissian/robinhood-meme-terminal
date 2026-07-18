// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RMTConsentLiquiditySession} from "./RMTConsentLiquiditySession.sol";
import {ISushiV3Factory} from "./interfaces/ISushiV3Factory.sol";
import {ISushiV3Pool} from "./interfaces/ISushiV3Pool.sol";
import {ISushiV3PositionManager} from "./interfaces/ISushiV3PositionManager.sol";

/// @notice Atomic, consent-only minting into one code-bound Sushi V3 pool on Robinhood Chain testnet.
/// @dev The caller supplies both assets, receives a newly minted LP NFT directly, and receives every
///      unused token before completion. There is no generic executor, pooled custody, bridge, source-pool
///      access, beneficiary override, upgrade path, arbitrary call, withdrawal, or administrative sweep.
contract RMTConsentLiquidityMigrator is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    uint256 public constant MAX_EXECUTION_WINDOW = 1 hours;
    int24 public constant MIN_TICK = -887_272;
    int24 public constant MAX_TICK = 887_272;

    bytes32 public constant CONFIGURATION_TYPEHASH = keccak256(
        "RMTConsentLiquidityConfiguration(address migrator,uint256 chainId,address governance,address guardian,address weth,address pairedToken,address positionManager,address factory,address pool,address session,uint24 poolFee,bytes32 positionManagerCodeHash,bytes32 factoryCodeHash,bytes32 poolCodeHash,bytes32 sessionCodeHash,bytes32 wethCodeHash,bytes32 pairedTokenCodeHash)"
    );
    bytes32 public constant TERMS_DOMAIN_TYPEHASH =
        keccak256("RMTConsentLiquidityTerms(bytes32 configurationHash,bytes32 termsDocumentHash)");
    bytes32 public constant MIGRATION_TYPEHASH = keccak256(
        "RMTConsentLiquidityMigration(uint256 chainId,address migrator,address owner,uint256 nonce,uint256 pairedTokenDesired,uint256 wethDesired,uint256 pairedTokenMinimum,uint256 wethMinimum,uint128 minimumLiquidity,int24 tickLower,int24 tickUpper,uint256 deadline,bytes32 acceptedTermsHash)"
    );

    struct Configuration {
        uint256 destinationChainId;
        address governance;
        address guardian;
        IERC20 weth;
        IERC20 pairedToken;
        ISushiV3PositionManager positionManager;
        ISushiV3Factory factory;
        ISushiV3Pool pool;
        RMTConsentLiquiditySession session;
        uint24 poolFee;
        bytes32 positionManagerCodeHash;
        bytes32 factoryCodeHash;
        bytes32 poolCodeHash;
        bytes32 sessionCodeHash;
        bytes32 wethCodeHash;
        bytes32 pairedTokenCodeHash;
        bytes32 termsDocumentHash;
    }

    struct MigrationRequest {
        uint256 pairedTokenDesired;
        uint256 wethDesired;
        uint256 pairedTokenMinimum;
        uint256 wethMinimum;
        uint128 minimumLiquidity;
        int24 tickLower;
        int24 tickUpper;
        uint256 deadline;
        bytes32 acceptedTermsHash;
    }

    uint256 public immutable destinationChainId;
    address public immutable governance;
    address public immutable guardian;
    IERC20 public immutable weth;
    IERC20 public immutable pairedToken;
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    bool public immutable pairedTokenIsToken0;
    ISushiV3PositionManager public immutable positionManager;
    ISushiV3Factory public immutable sushiFactory;
    ISushiV3Pool public immutable sushiPool;
    RMTConsentLiquiditySession public immutable liquiditySession;
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;

    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable poolCodeHash;
    bytes32 public immutable sessionCodeHash;
    bytes32 public immutable wethCodeHash;
    bytes32 public immutable pairedTokenCodeHash;
    bytes32 public immutable configurationHash;
    bytes32 public immutable termsDocumentHash;
    bytes32 public immutable migrationTermsHash;

    bool public paused;
    mapping(address owner => uint256 nonce) public migrationNonces;

    event PauseChanged(bool paused, address indexed caller);
    event LiquidityMigrated(
        bytes32 indexed migrationId,
        address indexed owner,
        uint256 indexed positionId,
        address session,
        uint256 pairedTokenUsed,
        uint256 wethUsed,
        uint256 pairedTokenRefunded,
        uint256 wethRefunded,
        uint128 mintedLiquidity,
        int24 tickLower,
        int24 tickUpper,
        bytes32 acceptedTermsHash
    );

    error Unauthorized();
    error InvalidConfiguration();
    error ConfigurationIntegrityFailed();
    error InvalidState();
    error InvalidMigration();
    error TermsNotAccepted();
    error PositionVerificationFailed();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    constructor(Configuration memory config) {
        _validateConfiguration(config);

        address token0Address =
            address(config.pairedToken) < address(config.weth) ? address(config.pairedToken) : address(config.weth);
        address token1Address =
            address(config.pairedToken) < address(config.weth) ? address(config.weth) : address(config.pairedToken);
        int24 tickSpacing = config.pool.tickSpacing();

        if (
            config.positionManager.factory() != address(config.factory)
                || config.positionManager.WETH9() != address(config.weth)
                || config.factory.getPool(token0Address, token1Address, config.poolFee) != address(config.pool)
                || config.factory.feeAmountTickSpacing(config.poolFee) != tickSpacing || tickSpacing <= 0
                || config.pool.factory() != address(config.factory) || config.pool.token0() != token0Address
                || config.pool.token1() != token1Address || config.pool.fee() != config.poolFee
                || config.session.ROBINHOOD_TESTNET_CHAIN_ID() != config.destinationChainId
                || config.session.router() != address(this)
                || address(config.session.pairedToken()) != address(config.pairedToken)
                || address(config.session.weth()) != address(config.weth)
                || address(config.session.token0()) != token0Address
                || address(config.session.token1()) != token1Address
                || address(config.session.positionManager()) != address(config.positionManager)
                || config.session.poolFee() != config.poolFee
                || config.session.pairedTokenIsToken0() != (token0Address == address(config.pairedToken))
                || config.session.activeMigrationId() != bytes32(0) || config.session.activeOwner() != address(0)
                || config.session.pairedTokenSessionBalanceBefore() != 0
                || config.session.wethSessionBalanceBefore() != 0 || config.session.pairedTokenOwnerBalanceBefore() != 0
                || config.session.wethOwnerBalanceBefore() != 0
        ) revert InvalidConfiguration();

        destinationChainId = config.destinationChainId;
        governance = config.governance;
        guardian = config.guardian;
        weth = config.weth;
        pairedToken = config.pairedToken;
        token0 = IERC20(token0Address);
        token1 = IERC20(token1Address);
        pairedTokenIsToken0 = token0Address == address(config.pairedToken);
        positionManager = config.positionManager;
        sushiFactory = config.factory;
        sushiPool = config.pool;
        liquiditySession = config.session;
        poolFee = config.poolFee;
        poolTickSpacing = tickSpacing;
        positionManagerCodeHash = config.positionManagerCodeHash;
        factoryCodeHash = config.factoryCodeHash;
        poolCodeHash = config.poolCodeHash;
        sessionCodeHash = config.sessionCodeHash;
        wethCodeHash = config.wethCodeHash;
        pairedTokenCodeHash = config.pairedTokenCodeHash;
        termsDocumentHash = config.termsDocumentHash;

        bytes32 boundConfigurationHash = keccak256(
            abi.encode(
                CONFIGURATION_TYPEHASH,
                address(this),
                config.destinationChainId,
                config.governance,
                config.guardian,
                address(config.weth),
                address(config.pairedToken),
                address(config.positionManager),
                address(config.factory),
                address(config.pool),
                address(config.session),
                config.poolFee,
                config.positionManagerCodeHash,
                config.factoryCodeHash,
                config.poolCodeHash,
                config.sessionCodeHash,
                config.wethCodeHash,
                config.pairedTokenCodeHash
            )
        );
        configurationHash = boundConfigurationHash;
        migrationTermsHash =
            keccak256(abi.encode(TERMS_DOMAIN_TYPEHASH, boundConfigurationHash, config.termsDocumentHash));

        // A deployment must be explicitly enabled by governance after explorer/configuration review.
        paused = true;
    }

    receive() external payable {
        revert InvalidMigration();
    }

    /// @notice The guardian or governance can stop new migrations immediately.
    function pause() external nonReentrant {
        if (msg.sender != governance && msg.sender != guardian) revert Unauthorized();
        if (paused) revert InvalidState();
        paused = true;
        emit PauseChanged(true, msg.sender);
    }

    /// @notice Only the configured governance contract can enable migrations after rechecking every binding.
    function unpause() external onlyGovernance nonReentrant {
        if (!paused) revert InvalidState();
        _requireConfigurationIntegrity();
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    /// @notice Mints one fresh position through the bound accounting session directly to the caller.
    function migrate(MigrationRequest calldata request)
        external
        nonReentrant
        returns (bytes32 migrationId, uint256 positionId, uint128 mintedLiquidity)
    {
        if (paused) revert InvalidState();
        _requireConfigurationIntegrity();
        _validateMigration(request);

        uint256 nonce = migrationNonces[msg.sender];
        migrationNonces[msg.sender] = nonce + 1;
        migrationId = keccak256(
            abi.encode(
                MIGRATION_TYPEHASH,
                block.chainid,
                address(this),
                msg.sender,
                nonce,
                request.pairedTokenDesired,
                request.wethDesired,
                request.pairedTokenMinimum,
                request.wethMinimum,
                request.minimumLiquidity,
                request.tickLower,
                request.tickUpper,
                request.deadline,
                request.acceptedTermsHash
            )
        );

        uint256 positionSupplyBefore = positionManager.totalSupply();
        liquiditySession.begin(msg.sender, migrationId);
        pairedToken.safeTransferFrom(msg.sender, address(liquiditySession), request.pairedTokenDesired);
        weth.safeTransferFrom(msg.sender, address(liquiditySession), request.wethDesired);

        uint256 pairedTokenUsed;
        uint256 wethUsed;
        uint256 pairedTokenRefunded;
        uint256 wethRefunded;
        (positionId, mintedLiquidity, pairedTokenUsed, wethUsed, pairedTokenRefunded, wethRefunded) =
            liquiditySession.execute(
                migrationId,
                RMTConsentLiquiditySession.SessionRequest({
                    pairedTokenDesired: request.pairedTokenDesired,
                    wethDesired: request.wethDesired,
                    pairedTokenMinimum: request.pairedTokenMinimum,
                    wethMinimum: request.wethMinimum,
                    minimumLiquidity: request.minimumLiquidity,
                    tickLower: request.tickLower,
                    tickUpper: request.tickUpper,
                    deadline: request.deadline
                })
            );

        if (
            positionManager.totalSupply() != positionSupplyBefore + 1
                || positionManager.tokenByIndex(positionSupplyBefore) != positionId
                || positionManager.ownerOf(positionId) != msg.sender
        ) {
            revert PositionVerificationFailed();
        }
        _verifyPosition(positionId, request, mintedLiquidity);
        _requireConfigurationIntegrity();
        emit LiquidityMigrated(
            migrationId,
            msg.sender,
            positionId,
            address(liquiditySession),
            pairedTokenUsed,
            wethUsed,
            pairedTokenRefunded,
            wethRefunded,
            mintedLiquidity,
            request.tickLower,
            request.tickUpper,
            request.acceptedTermsHash
        );
    }

    function _validateConfiguration(Configuration memory config) private view {
        if (
            config.destinationChainId != ROBINHOOD_TESTNET_CHAIN_ID || block.chainid != config.destinationChainId
                || config.governance == address(0) || config.governance.code.length == 0
                || config.guardian == address(0) || config.guardian == config.governance
                || address(config.weth) == address(0) || address(config.weth).code.length == 0
                || address(config.pairedToken) == address(0) || address(config.pairedToken).code.length == 0
                || address(config.weth) == address(config.pairedToken)
                || address(config.positionManager).code.length == 0 || address(config.factory).code.length == 0
                || address(config.pool).code.length == 0 || address(config.session).code.length == 0
                || config.poolFee == 0 || config.termsDocumentHash == bytes32(0)
                || config.positionManagerCodeHash == bytes32(0) || config.factoryCodeHash == bytes32(0)
                || config.poolCodeHash == bytes32(0) || config.sessionCodeHash == bytes32(0)
                || config.wethCodeHash == bytes32(0) || config.pairedTokenCodeHash == bytes32(0)
                || address(config.positionManager).codehash != config.positionManagerCodeHash
                || address(config.factory).codehash != config.factoryCodeHash
                || address(config.pool).codehash != config.poolCodeHash
                || address(config.session).codehash != config.sessionCodeHash
                || address(config.weth).codehash != config.wethCodeHash
                || address(config.pairedToken).codehash != config.pairedTokenCodeHash
        ) revert InvalidConfiguration();

        address[9] memory roles = [
            config.governance,
            config.guardian,
            address(config.weth),
            address(config.pairedToken),
            address(config.positionManager),
            address(config.factory),
            address(config.pool),
            address(config.session),
            address(this)
        ];
        for (uint256 i; i < roles.length; ++i) {
            for (uint256 j = i + 1; j < roles.length; ++j) {
                if (roles[i] == roles[j]) revert InvalidConfiguration();
            }
        }
    }

    function _validateMigration(MigrationRequest calldata request) private view {
        if (request.acceptedTermsHash != migrationTermsHash) revert TermsNotAccepted();
        if (
            request.pairedTokenDesired == 0 || request.wethDesired == 0 || request.pairedTokenMinimum == 0
                || request.wethMinimum == 0 || request.pairedTokenMinimum > request.pairedTokenDesired
                || request.wethMinimum > request.wethDesired || request.minimumLiquidity == 0
                || request.deadline < block.timestamp || request.deadline > block.timestamp + MAX_EXECUTION_WINDOW
                || request.tickLower < MIN_TICK || request.tickUpper > MAX_TICK
                || request.tickLower >= request.tickUpper || request.tickLower % poolTickSpacing != 0
                || request.tickUpper % poolTickSpacing != 0
        ) revert InvalidMigration();
    }

    function _verifyPosition(uint256 positionId, MigrationRequest calldata request, uint128 mintedLiquidity)
        private
        view
    {
        address actualToken0;
        address actualToken1;
        uint24 actualFee;
        int24 actualTickLower;
        int24 actualTickUpper;
        uint128 actualLiquidity;
        (,, actualToken0, actualToken1, actualFee, actualTickLower, actualTickUpper, actualLiquidity,,,,) =
            positionManager.positions(positionId);

        if (
            actualToken0 != address(token0) || actualToken1 != address(token1) || actualFee != poolFee
                || actualTickLower != request.tickLower || actualTickUpper != request.tickUpper
                || actualLiquidity != mintedLiquidity || actualLiquidity < request.minimumLiquidity
        ) revert PositionVerificationFailed();
    }

    function _requireConfigurationIntegrity() private view {
        if (
            block.chainid != destinationChainId || address(positionManager).codehash != positionManagerCodeHash
                || address(sushiFactory).codehash != factoryCodeHash || address(sushiPool).codehash != poolCodeHash
                || address(liquiditySession).codehash != sessionCodeHash || address(weth).codehash != wethCodeHash
                || address(pairedToken).codehash != pairedTokenCodeHash
                || positionManager.factory() != address(sushiFactory) || positionManager.WETH9() != address(weth)
                || sushiFactory.getPool(address(token0), address(token1), poolFee) != address(sushiPool)
                || sushiFactory.feeAmountTickSpacing(poolFee) != poolTickSpacing
                || sushiPool.factory() != address(sushiFactory) || sushiPool.token0() != address(token0)
                || sushiPool.token1() != address(token1) || sushiPool.fee() != poolFee
                || sushiPool.tickSpacing() != poolTickSpacing
                || liquiditySession.ROBINHOOD_TESTNET_CHAIN_ID() != destinationChainId
                || liquiditySession.router() != address(this)
                || address(liquiditySession.pairedToken()) != address(pairedToken)
                || address(liquiditySession.weth()) != address(weth)
                || address(liquiditySession.token0()) != address(token0)
                || address(liquiditySession.token1()) != address(token1)
                || address(liquiditySession.positionManager()) != address(positionManager)
                || liquiditySession.poolFee() != poolFee
                || liquiditySession.pairedTokenIsToken0() != pairedTokenIsToken0
                || liquiditySession.activeMigrationId() != bytes32(0) || liquiditySession.activeOwner() != address(0)
                || liquiditySession.pairedTokenSessionBalanceBefore() != 0
                || liquiditySession.wethSessionBalanceBefore() != 0
                || liquiditySession.pairedTokenOwnerBalanceBefore() != 0
                || liquiditySession.wethOwnerBalanceBefore() != 0
        ) revert ConfigurationIntegrityFailed();
    }
}
