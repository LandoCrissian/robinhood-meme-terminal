// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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
        "RMTConsentLiquidityConfiguration(address migrator,uint256 chainId,address governance,address guardian,address weth,address pairedToken,address positionManager,address factory,address pool,uint24 poolFee,bytes32 positionManagerCodeHash,bytes32 factoryCodeHash,bytes32 poolCodeHash,bytes32 wethCodeHash,bytes32 pairedTokenCodeHash)"
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
        uint24 poolFee;
        bytes32 positionManagerCodeHash;
        bytes32 factoryCodeHash;
        bytes32 poolCodeHash;
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
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;

    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable poolCodeHash;
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
    error InexactTokenTransfer();
    error ApprovalNotCleared();
    error SlippageExceeded();
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
        poolFee = config.poolFee;
        poolTickSpacing = tickSpacing;
        positionManagerCodeHash = config.positionManagerCodeHash;
        factoryCodeHash = config.factoryCodeHash;
        poolCodeHash = config.poolCodeHash;
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
                config.poolFee,
                config.positionManagerCodeHash,
                config.factoryCodeHash,
                config.poolCodeHash,
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

    /// @notice Mints one fresh position through the immutable manager directly to the caller.
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

        uint256 pairedOwnerBalanceBefore = pairedToken.balanceOf(msg.sender);
        uint256 wethOwnerBalanceBefore = weth.balanceOf(msg.sender);
        uint256 pairedRouterBalanceBefore = pairedToken.balanceOf(address(this));
        uint256 wethRouterBalanceBefore = weth.balanceOf(address(this));
        uint256 positionSupplyBefore = positionManager.totalSupply();

        _pullExact(pairedToken, msg.sender, request.pairedTokenDesired, pairedRouterBalanceBefore);
        _pullExact(weth, msg.sender, request.wethDesired, wethRouterBalanceBefore);

        pairedToken.forceApprove(address(positionManager), request.pairedTokenDesired);
        weth.forceApprove(address(positionManager), request.wethDesired);

        uint256 amount0Used;
        uint256 amount1Used;
        (positionId, mintedLiquidity, amount0Used, amount1Used) = positionManager.mint(_mintParams(request));

        pairedToken.forceApprove(address(positionManager), 0);
        weth.forceApprove(address(positionManager), 0);
        if (
            pairedToken.allowance(address(this), address(positionManager)) != 0
                || weth.allowance(address(this), address(positionManager)) != 0
        ) revert ApprovalNotCleared();

        uint256 pairedTokenUsed = pairedTokenIsToken0 ? amount0Used : amount1Used;
        uint256 wethUsed = pairedTokenIsToken0 ? amount1Used : amount0Used;
        if (
            positionId == 0 || mintedLiquidity < request.minimumLiquidity
                || pairedTokenUsed < request.pairedTokenMinimum || pairedTokenUsed > request.pairedTokenDesired
                || wethUsed < request.wethMinimum || wethUsed > request.wethDesired
                || pairedToken.balanceOf(address(this))
                    != pairedRouterBalanceBefore + request.pairedTokenDesired - pairedTokenUsed
                || weth.balanceOf(address(this)) != wethRouterBalanceBefore + request.wethDesired - wethUsed
        ) revert SlippageExceeded();

        if (
            positionManager.totalSupply() != positionSupplyBefore + 1
                || positionManager.tokenByIndex(positionSupplyBefore) != positionId
                || positionManager.ownerOf(positionId) != msg.sender
        ) {
            revert PositionVerificationFailed();
        }
        _verifyPosition(positionId, request, mintedLiquidity);

        uint256 pairedTokenRefunded = request.pairedTokenDesired - pairedTokenUsed;
        uint256 wethRefunded = request.wethDesired - wethUsed;
        if (pairedTokenRefunded != 0) pairedToken.safeTransfer(msg.sender, pairedTokenRefunded);
        if (wethRefunded != 0) weth.safeTransfer(msg.sender, wethRefunded);

        if (
            pairedToken.balanceOf(address(this)) != pairedRouterBalanceBefore
                || weth.balanceOf(address(this)) != wethRouterBalanceBefore
                || pairedToken.balanceOf(msg.sender) != pairedOwnerBalanceBefore - pairedTokenUsed
                || weth.balanceOf(msg.sender) != wethOwnerBalanceBefore - wethUsed
        ) revert InexactTokenTransfer();

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
                || address(config.pool).code.length == 0 || config.poolFee == 0
                || config.termsDocumentHash == bytes32(0) || config.positionManagerCodeHash == bytes32(0)
                || config.factoryCodeHash == bytes32(0) || config.poolCodeHash == bytes32(0)
                || config.wethCodeHash == bytes32(0) || config.pairedTokenCodeHash == bytes32(0)
                || address(config.positionManager).codehash != config.positionManagerCodeHash
                || address(config.factory).codehash != config.factoryCodeHash
                || address(config.pool).codehash != config.poolCodeHash
                || address(config.weth).codehash != config.wethCodeHash
                || address(config.pairedToken).codehash != config.pairedTokenCodeHash
        ) revert InvalidConfiguration();

        address[8] memory roles = [
            config.governance,
            config.guardian,
            address(config.weth),
            address(config.pairedToken),
            address(config.positionManager),
            address(config.factory),
            address(config.pool),
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

    function _mintParams(MigrationRequest calldata request)
        private
        view
        returns (ISushiV3PositionManager.MintParams memory params)
    {
        params = ISushiV3PositionManager.MintParams({
            token0: address(token0),
            token1: address(token1),
            fee: poolFee,
            tickLower: request.tickLower,
            tickUpper: request.tickUpper,
            amount0Desired: pairedTokenIsToken0 ? request.pairedTokenDesired : request.wethDesired,
            amount1Desired: pairedTokenIsToken0 ? request.wethDesired : request.pairedTokenDesired,
            amount0Min: pairedTokenIsToken0 ? request.pairedTokenMinimum : request.wethMinimum,
            amount1Min: pairedTokenIsToken0 ? request.wethMinimum : request.pairedTokenMinimum,
            recipient: msg.sender,
            deadline: request.deadline
        });
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
                || address(weth).codehash != wethCodeHash || address(pairedToken).codehash != pairedTokenCodeHash
                || positionManager.factory() != address(sushiFactory) || positionManager.WETH9() != address(weth)
                || sushiFactory.getPool(address(token0), address(token1), poolFee) != address(sushiPool)
                || sushiFactory.feeAmountTickSpacing(poolFee) != poolTickSpacing
                || sushiPool.factory() != address(sushiFactory) || sushiPool.token0() != address(token0)
                || sushiPool.token1() != address(token1) || sushiPool.fee() != poolFee
                || sushiPool.tickSpacing() != poolTickSpacing
        ) revert ConfigurationIntegrityFailed();
    }

    function _pullExact(IERC20 token, address owner, uint256 amount, uint256 balanceBefore) private {
        token.safeTransferFrom(owner, address(this), amount);
        if (token.balanceOf(address(this)) != balanceBefore + amount) revert InexactTokenTransfer();
    }
}
