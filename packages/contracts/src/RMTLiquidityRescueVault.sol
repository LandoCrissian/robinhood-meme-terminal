// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ILiquidityRescueSeeder} from "./interfaces/ILiquidityRescueSeeder.sol";

interface IRescueERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool);
}

interface IRescueWETH is IRescueERC20 {
    function deposit() external payable;
}

/// @notice Opt-in destination vault that accounts for voluntarily supplied liquidity intended for one
///         Robinhood Chain WETH pair.
/// @dev Research prototype hard-gated to Robinhood Chain testnet. This contract cannot withdraw
///      third-party pools, bridge assets, upgrade itself, change its
///      seeder, or execute arbitrary calls. Source-chain custody and message verification belong in
///      separately reviewed bridge-specific intake adapters. Until finalization, every credited WETH
///      contributor can recover their contribution if the campaign is cancelled or expires.
contract RMTLiquidityRescueVault {
    uint256 public constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

    enum CampaignState {
        Funding,
        Finalized,
        Cancelled
    }

    struct SourceChain {
        uint256 cap;
        uint256 contributed;
        bool enabled;
    }

    uint256 public immutable destinationChainId;
    address public immutable governance;
    address public immutable guardian;
    IRescueWETH public immutable weth;
    IRescueERC20 public immutable pairedToken;
    ILiquidityRescueSeeder public immutable liquiditySeeder;
    address public immutable liquidityCustodian;
    uint256 public immutable globalContributionCap;
    uint256 public immutable minimumLiquidityWeth;
    uint64 public immutable fundingDeadline;

    CampaignState public state;
    bool public paused;
    bool private _entered;
    uint256 public totalContributedWeth;
    uint256 public totalRefundedWeth;
    uint256 public totalPairedTokenFunded;
    uint256 public totalPairedTokenRefunded;
    bytes32 public liquidityPositionId;
    uint256 public seededLiquidity;

    mapping(uint256 sourceChainId => SourceChain source) public sourceChains;
    mapping(address adapter => uint256 sourceChainId) public intakeAdapterSourceChains;
    mapping(bytes32 replayKey => bool consumed) public consumedMigrations;
    mapping(address beneficiary => uint256 amount) public contributedWeth;
    mapping(address funder => uint256 amount) public pairedTokenFunding;

    event SourceChainConfigured(uint256 indexed sourceChainId, uint256 cap, bool enabled);
    event IntakeAdapterConfigured(address indexed adapter, uint256 indexed sourceChainId, bool allowed);
    event PauseChanged(bool paused, address indexed caller);
    event WethContributed(
        address indexed beneficiary,
        address indexed payer,
        uint256 indexed sourceChainId,
        bytes32 sourcePool,
        bytes32 migrationId,
        uint256 amount
    );
    event PairedTokenFunded(address indexed funder, uint256 amount);
    event CampaignCancelled(address indexed caller, bool expired);
    event WethRefunded(address indexed beneficiary, uint256 amount);
    event PairedTokenRefunded(address indexed funder, uint256 amount);
    event LiquiditySeeded(
        bytes32 indexed positionId,
        uint256 pairedTokenAmount,
        uint256 wethAmount,
        uint256 liquidity,
        address indexed custodian
    );

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidState();
    error InvalidContribution();
    error SourceChainUnavailable();
    error ContributionCapExceeded();
    error MigrationAlreadyConsumed();
    error CampaignExpired();
    error CampaignNotExpired();
    error NothingToRefund();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error SnapshotMismatch();
    error TokenOperationFailed();
    error InexactTokenTransfer();
    error ReentrantCall();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        uint256 destinationChainId_,
        address governance_,
        address guardian_,
        IRescueWETH weth_,
        IRescueERC20 pairedToken_,
        ILiquidityRescueSeeder liquiditySeeder_,
        address liquidityCustodian_,
        uint256 globalContributionCap_,
        uint256 minimumLiquidityWeth_,
        uint64 fundingDeadline_
    ) {
        if (
            destinationChainId_ != ROBINHOOD_TESTNET_CHAIN_ID || block.chainid != destinationChainId_
                || governance_ == address(0) || governance_.code.length == 0 || guardian_ == address(0)
                || address(weth_) == address(0) || address(weth_).code.length == 0
                || address(pairedToken_) == address(0) || address(pairedToken_).code.length == 0
                || address(pairedToken_) == address(weth_) || address(liquiditySeeder_) == address(0)
                || address(liquiditySeeder_).code.length == 0 || liquidityCustodian_ == address(0)
                || liquidityCustodian_.code.length == 0 || globalContributionCap_ == 0 || minimumLiquidityWeth_ == 0
                || minimumLiquidityWeth_ > globalContributionCap_ || fundingDeadline_ <= block.timestamp
                || fundingDeadline_ > block.timestamp + 180 days
        ) revert InvalidConfiguration();

        destinationChainId = destinationChainId_;
        governance = governance_;
        guardian = guardian_;
        weth = weth_;
        pairedToken = pairedToken_;
        liquiditySeeder = liquiditySeeder_;
        liquidityCustodian = liquidityCustodian_;
        globalContributionCap = globalContributionCap_;
        minimumLiquidityWeth = minimumLiquidityWeth_;
        fundingDeadline = fundingDeadline_;

        sourceChains[destinationChainId_] = SourceChain({cap: globalContributionCap_, contributed: 0, enabled: true});
        emit SourceChainConfigured(destinationChainId_, globalContributionCap_, true);
    }

    receive() external payable {
        revert InvalidContribution();
    }

    /// @notice Enables or caps a source through the configured governance contract.
    function configureSourceChain(uint256 sourceChainId, uint256 cap, bool enabled) external onlyGovernance {
        if (state != CampaignState.Funding) revert InvalidState();
        if (sourceChainId == 0 || cap == 0 || cap > globalContributionCap) revert InvalidConfiguration();
        SourceChain storage source = sourceChains[sourceChainId];
        if (cap < source.contributed) revert InvalidConfiguration();
        source.cap = cap;
        source.enabled = enabled;
        emit SourceChainConfigured(sourceChainId, cap, enabled);
    }

    /// @notice Admits only a separately reviewed bridge adapter; adapters receive no finalization authority.
    function configureIntakeAdapter(address adapter, uint256 sourceChainId, bool allowed) external onlyGovernance {
        if (state != CampaignState.Funding) revert InvalidState();
        if (
            adapter == address(0) || sourceChainId == 0 || sourceChainId == destinationChainId
                || (allowed && (adapter.code.length == 0 || sourceChains[sourceChainId].cap == 0))
        ) revert InvalidConfiguration();
        if (!allowed && intakeAdapterSourceChains[adapter] != sourceChainId) revert InvalidConfiguration();
        intakeAdapterSourceChains[adapter] = allowed ? sourceChainId : 0;
        emit IntakeAdapterConfigured(adapter, sourceChainId, allowed);
    }

    /// @notice The guardian can stop deposits immediately; only governance can reopen them.
    function pause() external {
        if (msg.sender != governance && msg.sender != guardian) revert Unauthorized();
        if (paused || state != CampaignState.Funding) revert InvalidState();
        paused = true;
        emit PauseChanged(true, msg.sender);
    }

    function unpause() external onlyGovernance {
        if (!paused || state != CampaignState.Funding) revert InvalidState();
        if (block.timestamp > fundingDeadline) revert CampaignExpired();
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    /// @notice Wraps native ETH on Robinhood Chain into the configured canonical WETH asset.
    function contributeNative(address beneficiary) external payable nonReentrant {
        _requireFunding();
        if (beneficiary == address(0) || beneficiary == address(this) || msg.value == 0) {
            revert InvalidContribution();
        }
        uint256 beforeBalance = weth.balanceOf(address(this));
        weth.deposit{value: msg.value}();
        if (weth.balanceOf(address(this)) != beforeBalance + msg.value) revert InexactTokenTransfer();
        _recordContribution(beneficiary, msg.sender, destinationChainId, bytes32(0), bytes32(0), msg.value);
    }

    function contributeWeth(address beneficiary, uint256 amount) external nonReentrant {
        _requireFunding();
        if (beneficiary == address(0) || beneficiary == address(this) || amount == 0) revert InvalidContribution();
        _pullExact(weth, msg.sender, amount);
        _recordContribution(beneficiary, msg.sender, destinationChainId, bytes32(0), bytes32(0), amount);
    }

    /// @notice Records an already-bridged WETH contribution from a reviewed bridge-specific adapter.
    /// @dev `migrationId` must bind the source transaction/message and prevents adapter replay.
    function contributeFromAdapter(
        address beneficiary,
        uint256 sourceChainId,
        bytes32 sourcePool,
        bytes32 migrationId,
        uint256 amount
    ) external nonReentrant {
        _requireFunding();
        if (intakeAdapterSourceChains[msg.sender] != sourceChainId) revert Unauthorized();
        if (
            beneficiary == address(0) || beneficiary == address(this) || sourceChainId == destinationChainId
                || sourcePool == bytes32(0) || migrationId == bytes32(0) || amount == 0
        ) revert InvalidContribution();
        bytes32 replayKey = migrationReplayKey(msg.sender, sourceChainId, sourcePool, migrationId);
        if (consumedMigrations[replayKey]) revert MigrationAlreadyConsumed();
        consumedMigrations[replayKey] = true;
        _pullExact(weth, msg.sender, amount);
        _recordContribution(beneficiary, msg.sender, sourceChainId, sourcePool, migrationId, amount);
    }

    /// @notice Supplies the RMT-side asset needed for the final WETH pair without diluting WETH attribution.
    function fundPairedToken(uint256 amount) external onlyGovernance nonReentrant {
        _requireFunding();
        if (amount == 0) revert InvalidContribution();
        _pullExact(pairedToken, msg.sender, amount);
        pairedTokenFunding[msg.sender] += amount;
        totalPairedTokenFunded += amount;
        emit PairedTokenFunded(msg.sender, amount);
    }

    /// @notice Irreversibly creates one destination position from a paused, exact accounting snapshot.
    /// @dev Unsolicited token balances are excluded. The immutable seeder must consume both credited
    ///      amounts exactly or the entire transaction reverts.
    function seedLiquidity(
        uint256 expectedPairedTokenAmount,
        uint256 expectedWethAmount,
        uint256 minimumLiquidity,
        uint256 deadline
    ) external onlyGovernance nonReentrant returns (bytes32 positionId, uint256 liquidity) {
        _requireFinalizable();
        if (minimumLiquidity == 0 || deadline < block.timestamp || deadline > block.timestamp + 1 hours) {
            revert InvalidConfiguration();
        }

        if (
            expectedWethAmount != totalContributedWeth || expectedPairedTokenAmount != totalPairedTokenFunded
                || expectedPairedTokenAmount == 0
        ) revert SnapshotMismatch();

        uint256 wethBalanceBefore = weth.balanceOf(address(this));
        uint256 pairedTokenBalanceBefore = pairedToken.balanceOf(address(this));
        if (
            expectedWethAmount < minimumLiquidityWeth || wethBalanceBefore < expectedWethAmount
                || pairedTokenBalanceBefore < expectedPairedTokenAmount
        ) {
            revert InsufficientLiquidity();
        }

        state = CampaignState.Finalized;
        _approveExact(weth, address(liquiditySeeder), expectedWethAmount);
        _approveExact(pairedToken, address(liquiditySeeder), expectedPairedTokenAmount);

        (positionId, liquidity) = liquiditySeeder.seedLiquidity(
            address(pairedToken),
            address(weth),
            expectedPairedTokenAmount,
            expectedWethAmount,
            minimumLiquidity,
            deadline,
            liquidityCustodian
        );

        _approveExact(weth, address(liquiditySeeder), 0);
        _approveExact(pairedToken, address(liquiditySeeder), 0);
        if (
            positionId == bytes32(0) || liquidity < minimumLiquidity
                || weth.balanceOf(address(this)) != wethBalanceBefore - expectedWethAmount
                || pairedToken.balanceOf(address(this)) != pairedTokenBalanceBefore - expectedPairedTokenAmount
        ) revert SlippageExceeded();

        liquidityPositionId = positionId;
        seededLiquidity = liquidity;
        emit LiquiditySeeded(positionId, expectedPairedTokenAmount, expectedWethAmount, liquidity, liquidityCustodian);
    }

    /// @notice Domains replay protection by this vault, adapter, source chain, and source pool.
    function migrationReplayKey(address adapter, uint256 sourceChainId, bytes32 sourcePool, bytes32 migrationId)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), adapter, sourceChainId, sourcePool, migrationId));
    }

    /// @notice Guardian cancellation is a one-way safety action that only enables contributor refunds.
    function cancel() external {
        if (msg.sender != governance && msg.sender != guardian) revert Unauthorized();
        _cancel(false);
    }

    /// @notice Anyone can unlock refunds after an unfinalized campaign expires.
    function cancelExpired() external {
        if (block.timestamp <= fundingDeadline) revert CampaignNotExpired();
        _cancel(true);
    }

    function claimWethRefund() external nonReentrant {
        if (state != CampaignState.Cancelled) revert InvalidState();
        uint256 amount = contributedWeth[msg.sender];
        if (amount == 0) revert NothingToRefund();
        contributedWeth[msg.sender] = 0;
        totalRefundedWeth += amount;
        _safeTransfer(weth, msg.sender, amount);
        emit WethRefunded(msg.sender, amount);
    }

    function claimPairedTokenRefund() external nonReentrant {
        if (state != CampaignState.Cancelled) revert InvalidState();
        uint256 amount = pairedTokenFunding[msg.sender];
        if (amount == 0) revert NothingToRefund();
        pairedTokenFunding[msg.sender] = 0;
        totalPairedTokenRefunded += amount;
        _safeTransfer(pairedToken, msg.sender, amount);
        emit PairedTokenRefunded(msg.sender, amount);
    }

    function _recordContribution(
        address beneficiary,
        address payer,
        uint256 sourceChainId,
        bytes32 sourcePool,
        bytes32 migrationId,
        uint256 amount
    ) private {
        SourceChain storage source = sourceChains[sourceChainId];
        if (!source.enabled || source.cap == 0) revert SourceChainUnavailable();
        if (source.contributed + amount > source.cap || totalContributedWeth + amount > globalContributionCap) {
            revert ContributionCapExceeded();
        }
        source.contributed += amount;
        totalContributedWeth += amount;
        contributedWeth[beneficiary] += amount;
        emit WethContributed(beneficiary, payer, sourceChainId, sourcePool, migrationId, amount);
    }

    function _requireFunding() private view {
        if (state != CampaignState.Funding || paused) revert InvalidState();
        if (block.timestamp > fundingDeadline) revert CampaignExpired();
    }

    function _requireFinalizable() private view {
        if (state != CampaignState.Funding || !paused) revert InvalidState();
        if (block.timestamp > fundingDeadline) revert CampaignExpired();
    }

    function _cancel(bool expired) private {
        if (state != CampaignState.Funding) revert InvalidState();
        state = CampaignState.Cancelled;
        paused = true;
        emit CampaignCancelled(msg.sender, expired);
    }

    function _pullExact(IRescueERC20 token, address payer, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        _callToken(token, abi.encodeWithSelector(token.transferFrom.selector, payer, address(this), amount));
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert InexactTokenTransfer();
    }

    function _safeTransfer(IRescueERC20 token, address recipient, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(recipient);
        _callToken(token, abi.encodeWithSelector(token.transfer.selector, recipient, amount));
        if (token.balanceOf(recipient) != beforeBalance + amount) revert InexactTokenTransfer();
    }

    function _approveExact(IRescueERC20 token, address spender, uint256 amount) private {
        if (token.allowance(address(this), spender) != 0) {
            _callToken(token, abi.encodeWithSelector(token.approve.selector, spender, 0));
        }
        if (amount != 0) _callToken(token, abi.encodeWithSelector(token.approve.selector, spender, amount));
    }

    function _callToken(IRescueERC20 token, bytes memory data) private {
        (bool success, bytes memory result) = address(token).call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenOperationFailed();
    }
}
