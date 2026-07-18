// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLiquidityRescueVault, IRescueERC20, IRescueWETH} from "../src/RMTLiquidityRescueVault.sol";
import {ILiquidityRescueSeeder} from "../src/interfaces/ILiquidityRescueSeeder.sol";

interface RescueVm {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract RescueMockERC20 is IRescueERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) private {
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract RescueMockWETH is RescueMockERC20, IRescueWETH {
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }
}

contract RescueMockGovernance {}

contract RescueMockAdapter {}

contract RescueMockCustodian {}

contract RescueMockSeeder is ILiquidityRescueSeeder {
    address public lastPairedToken;
    address public lastWeth;
    address public lastCustodian;
    uint256 public lastPairedTokenAmount;
    uint256 public lastWethAmount;
    uint256 public liquidityToReturn = 1_000 ether;
    bytes32 public positionIdToReturn = keccak256("RMT_RESCUE_POSITION");
    bool public consumeAll = true;

    function setResult(bytes32 positionId, uint256 liquidity, bool consumeAll_) external {
        positionIdToReturn = positionId;
        liquidityToReturn = liquidity;
        consumeAll = consumeAll_;
    }

    function seedLiquidity(
        address pairedToken,
        address weth,
        uint256 pairedTokenAmount,
        uint256 wethAmount,
        uint256,
        uint256,
        address liquidityCustodian
    ) external returns (bytes32 positionId, uint256 liquidity) {
        lastPairedToken = pairedToken;
        lastWeth = weth;
        lastCustodian = liquidityCustodian;
        lastPairedTokenAmount = pairedTokenAmount;
        lastWethAmount = wethAmount;
        uint256 pairedToConsume = consumeAll ? pairedTokenAmount : pairedTokenAmount - 1;
        IRescueERC20(pairedToken).transferFrom(msg.sender, address(this), pairedToConsume);
        IRescueERC20(weth).transferFrom(msg.sender, address(this), wethAmount);
        return (positionIdToReturn, liquidityToReturn);
    }
}

contract RMTLiquidityRescueVaultTest {
    RescueVm private constant vm = RescueVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant DESTINATION_CHAIN_ID = 46_630;
    uint256 private constant SOURCE_CHAIN_ID = 1;
    address private constant GUARDIAN = address(0xA11CE);
    address private constant BENEFICIARY = address(0xBEEF);

    RescueMockWETH private weth;
    RescueMockERC20 private pairedToken;
    RescueMockSeeder private seeder;
    RescueMockGovernance private governance;
    RescueMockAdapter private adapter;
    RescueMockCustodian private custodian;
    RMTLiquidityRescueVault private vault;
    uint64 private deadline;

    function setUp() public {
        vm.chainId(DESTINATION_CHAIN_ID);
        vm.deal(address(this), 100 ether);
        weth = new RescueMockWETH();
        pairedToken = new RescueMockERC20();
        seeder = new RescueMockSeeder();
        governance = new RescueMockGovernance();
        adapter = new RescueMockAdapter();
        custodian = new RescueMockCustodian();
        deadline = uint64(block.timestamp + 7 days);
        vault = new RMTLiquidityRescueVault(
            DESTINATION_CHAIN_ID,
            address(governance),
            GUARDIAN,
            IRescueWETH(address(weth)),
            IRescueERC20(address(pairedToken)),
            ILiquidityRescueSeeder(address(seeder)),
            address(custodian),
            100 ether,
            10 ether,
            deadline
        );
    }

    function testWrapsRobinhoodEthAndCreditsBeneficiary() public {
        vault.contributeNative{value: 12 ether}(BENEFICIARY);

        require(weth.balanceOf(address(vault)) == 12 ether, "WETH not wrapped");
        require(vault.contributedWeth(BENEFICIARY) == 12 ether, "beneficiary not credited");
        require(vault.totalContributedWeth() == 12 ether, "total not credited");
        (uint256 cap, uint256 contributed, bool enabled) = vault.sourceChains(DESTINATION_CHAIN_ID);
        require(cap == 100 ether && contributed == 12 ether && enabled, "destination source accounting");
    }

    function testPullsWethExactly() public {
        weth.mint(address(this), 5 ether);
        weth.approve(address(vault), 5 ether);

        vault.contributeWeth(BENEFICIARY, 5 ether);

        require(weth.balanceOf(address(vault)) == 5 ether, "WETH not pulled");
        require(vault.contributedWeth(BENEFICIARY) == 5 ether, "credit missing");
    }

    function testApprovedAdapterRecordsOneCappedMigration() public {
        _configureSourceAndAdapter(20 ether);
        weth.mint(address(adapter), 8 ether);
        vm.prank(address(adapter));
        weth.approve(address(vault), 8 ether);

        bytes32 migrationId = keccak256("ethereum-pool-withdrawal-1");
        vm.prank(address(adapter));
        vault.contributeFromAdapter(BENEFICIARY, SOURCE_CHAIN_ID, keccak256("source-pool"), migrationId, 8 ether);

        bytes32 replayKey =
            vault.migrationReplayKey(address(adapter), SOURCE_CHAIN_ID, keccak256("source-pool"), migrationId);
        require(vault.consumedMigrations(replayKey), "migration not consumed");
        require(vault.contributedWeth(BENEFICIARY) == 8 ether, "bridge credit missing");
        (, uint256 contributed,) = vault.sourceChains(SOURCE_CHAIN_ID);
        require(contributed == 8 ether, "source total missing");

        weth.mint(address(adapter), 8 ether);
        vm.prank(address(adapter));
        weth.approve(address(vault), 8 ether);
        vm.prank(address(adapter));
        (bool replayed,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector,
                    BENEFICIARY,
                    SOURCE_CHAIN_ID,
                    keccak256("source-pool"),
                    migrationId,
                    8 ether
                )
            );
        require(!replayed, "migration replay accepted");
    }

    function testAdapterCannotSpoofAnotherSourceAndFailedPullDoesNotConsumeReplay() public {
        _configureSourceAndAdapter(20 ether);
        uint256 otherSourceChainId = 10;
        vm.prank(address(governance));
        vault.configureSourceChain(otherSourceChainId, 20 ether, true);

        bytes32 sourcePool = keccak256("source-pool");
        bytes32 migrationId = keccak256("migration");
        vm.prank(address(adapter));
        (bool spoofedSource,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector,
                    BENEFICIARY,
                    otherSourceChainId,
                    sourcePool,
                    migrationId,
                    1 ether
                )
            );
        require(!spoofedSource, "adapter spoofed source chain");

        bytes32 replayKey = vault.migrationReplayKey(address(adapter), SOURCE_CHAIN_ID, sourcePool, migrationId);
        vm.prank(address(adapter));
        (bool failedPull,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector, BENEFICIARY, SOURCE_CHAIN_ID, sourcePool, migrationId, 1 ether
                )
            );
        require(!failedPull, "unfunded adapter contribution accepted");
        require(!vault.consumedMigrations(replayKey), "failed pull consumed replay key");
    }

    function testRejectsUnapprovedAdapterAndDisabledSource() public {
        weth.mint(address(adapter), 2 ether);
        vm.prank(address(adapter));
        weth.approve(address(vault), 2 ether);
        vm.prank(address(adapter));
        (bool unapproved,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector,
                    BENEFICIARY,
                    SOURCE_CHAIN_ID,
                    keccak256("source-pool"),
                    keccak256("migration"),
                    2 ether
                )
            );
        require(!unapproved, "unapproved adapter accepted");

        vm.prank(address(governance));
        vault.configureSourceChain(SOURCE_CHAIN_ID, 2 ether, false);
        vm.prank(address(governance));
        vault.configureIntakeAdapter(address(adapter), SOURCE_CHAIN_ID, true);
        vm.prank(address(adapter));
        (bool disabledSource,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector,
                    BENEFICIARY,
                    SOURCE_CHAIN_ID,
                    keccak256("source-pool"),
                    keccak256("migration-2"),
                    2 ether
                )
            );
        require(!disabledSource, "disabled source accepted");
    }

    function testEnforcesSourceAndGlobalCaps() public {
        _configureSourceAndAdapter(3 ether);
        weth.mint(address(adapter), 4 ether);
        vm.prank(address(adapter));
        weth.approve(address(vault), 4 ether);
        vm.prank(address(adapter));
        (bool overSourceCap,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.contributeFromAdapter.selector,
                    BENEFICIARY,
                    SOURCE_CHAIN_ID,
                    keccak256("source-pool"),
                    keccak256("migration"),
                    4 ether
                )
            );
        require(!overSourceCap, "source cap bypassed");

        vault.contributeNative{value: 100 ether}(BENEFICIARY);
        weth.mint(address(this), 1);
        weth.approve(address(vault), 1);
        (bool overGlobalCap,) =
            address(vault).call(abi.encodeWithSelector(vault.contributeWeth.selector, BENEFICIARY, 1));
        require(!overGlobalCap, "global cap bypassed");
    }

    function testGuardianCanPauseButOnlyGovernanceCanUnpause() public {
        vm.prank(GUARDIAN);
        vault.pause();

        (bool blocked,) =
            address(vault).call{value: 1 ether}(abi.encodeWithSelector(vault.contributeNative.selector, BENEFICIARY));
        require(!blocked, "paused contribution accepted");

        vm.prank(GUARDIAN);
        (bool guardianUnpaused,) = address(vault).call(abi.encodeWithSelector(vault.unpause.selector));
        require(!guardianUnpaused, "guardian unpaused campaign");

        vm.prank(address(governance));
        vault.unpause();
        vault.contributeNative{value: 1 ether}(BENEFICIARY);
        require(vault.totalContributedWeth() == 1 ether, "governance unpause failed");
    }

    function testCancellationRefundsBothSidesExactlyOnce() public {
        vault.contributeNative{value: 12 ether}(address(this));
        _fundPairedToken(50 ether);

        vm.prank(GUARDIAN);
        vault.cancel();
        vault.claimWethRefund();
        vm.prank(address(governance));
        vault.claimPairedTokenRefund();

        require(weth.balanceOf(address(this)) == 12 ether, "WETH refund missing");
        require(pairedToken.balanceOf(address(governance)) == 50 ether, "pair refund missing");
        require(vault.totalRefundedWeth() == 12 ether, "WETH refund total");
        require(vault.totalPairedTokenRefunded() == 50 ether, "pair refund total");
        (bool secondRefund,) = address(vault).call(abi.encodeWithSelector(vault.claimWethRefund.selector));
        require(!secondRefund, "double refund accepted");
    }

    function testAnyoneCanCancelExpiredCampaign() public {
        vm.warp(deadline + 1);
        vm.prank(address(0x1234));
        vault.cancelExpired();
        require(uint8(vault.state()) == uint8(RMTLiquidityRescueVault.CampaignState.Cancelled), "not cancelled");
    }

    function testSeedsExactCreditedPairThroughFixedConfiguration() public {
        vault.contributeNative{value: 12 ether}(BENEFICIARY);
        _fundPairedToken(1_000_000 ether);

        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(address(governance));
        (bytes32 positionId, uint256 liquidity) =
            vault.seedLiquidity(1_000_000 ether, 12 ether, 900 ether, block.timestamp + 10 minutes);

        require(positionId == keccak256("RMT_RESCUE_POSITION"), "position id");
        require(liquidity == 1_000 ether, "liquidity");
        require(seeder.lastWeth() == address(weth), "wrong WETH");
        require(seeder.lastPairedToken() == address(pairedToken), "wrong paired token");
        require(seeder.lastWethAmount() == 12 ether, "wrong WETH amount");
        require(seeder.lastPairedTokenAmount() == 1_000_000 ether, "wrong pair amount");
        require(seeder.lastCustodian() == address(custodian), "wrong custodian");
        require(uint8(vault.state()) == uint8(RMTLiquidityRescueVault.CampaignState.Finalized), "not final");
        require(weth.balanceOf(address(vault)) == 0, "WETH retained");
        require(pairedToken.balanceOf(address(vault)) == 0, "pair retained");
    }

    function testRejectsFinalizationBelowThresholdOrPartialConsumption() public {
        vault.contributeNative{value: 9 ether}(BENEFICIARY);
        _fundPairedToken(100 ether);
        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(address(governance));
        (bool belowThreshold,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.seedLiquidity.selector, 100 ether, 9 ether, 1 ether, block.timestamp + 10 minutes
                )
            );
        require(!belowThreshold, "below threshold finalized");

        vm.prank(address(governance));
        vault.unpause();
        vault.contributeNative{value: 1 ether}(BENEFICIARY);
        seeder.setResult(keccak256("POSITION"), 1_000 ether, false);
        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(address(governance));
        (bool partialConsumption,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.seedLiquidity.selector, 100 ether, 10 ether, 1 ether, block.timestamp + 10 minutes
                )
            );
        require(!partialConsumption, "partial seeding accepted");
        require(uint8(vault.state()) == uint8(RMTLiquidityRescueVault.CampaignState.Funding), "state consumed");
    }

    function testRejectsDeploymentOnWrongChain() public {
        vm.chainId(1);
        (bool success,) = address(this).call(abi.encodeWithSelector(this.deployVault.selector));
        require(!success, "wrong-chain deployment accepted");
        vm.chainId(DESTINATION_CHAIN_ID);
    }

    function testRejectsDeploymentOnRobinhoodMainnet() public {
        vm.chainId(4_663);
        (bool success,) = address(this).call(abi.encodeWithSelector(this.deployVaultFor.selector, 4_663));
        require(!success, "mainnet prototype deployment accepted");
        vm.chainId(DESTINATION_CHAIN_ID);
    }

    function testRequiresPausedExactSnapshotAndExcludesUnsolicitedBalances() public {
        vault.contributeNative{value: 12 ether}(BENEFICIARY);
        _fundPairedToken(1_000 ether);
        weth.mint(address(vault), 3 ether);
        pairedToken.mint(address(vault), 5 ether);

        vm.prank(address(governance));
        (bool unpausedSeed,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.seedLiquidity.selector, 1_000 ether, 12 ether, 1 ether, block.timestamp + 10 minutes
                )
            );
        require(!unpausedSeed, "unpaused snapshot finalized");

        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(address(governance));
        (bool mismatchedSnapshot,) = address(vault)
            .call(
                abi.encodeWithSelector(
                    vault.seedLiquidity.selector, 1_005 ether, 15 ether, 1 ether, block.timestamp + 10 minutes
                )
            );
        require(!mismatchedSnapshot, "uncredited balances entered snapshot");

        vm.prank(address(governance));
        vault.seedLiquidity(1_000 ether, 12 ether, 1 ether, block.timestamp + 10 minutes);
        require(seeder.lastPairedTokenAmount() == 1_000 ether, "unsolicited paired token seeded");
        require(seeder.lastWethAmount() == 12 ether, "unsolicited WETH seeded");
        require(pairedToken.balanceOf(address(vault)) == 5 ether, "paired donation consumed");
        require(weth.balanceOf(address(vault)) == 3 ether, "WETH donation consumed");
    }

    function testOnlyGovernanceCanFundPairedTokenAndVaultCannotBeBeneficiary() public {
        pairedToken.mint(address(this), 1 ether);
        pairedToken.approve(address(vault), 1 ether);
        (bool funded,) = address(vault).call(abi.encodeWithSelector(vault.fundPairedToken.selector, 1 ether));
        require(!funded, "untrusted paired-token funder accepted");

        (bool selfBeneficiary,) =
            address(vault).call{value: 1 ether}(abi.encodeWithSelector(vault.contributeNative.selector, address(vault)));
        require(!selfBeneficiary, "vault credited as beneficiary");
    }

    function deployVault() external returns (RMTLiquidityRescueVault) {
        return new RMTLiquidityRescueVault(
            DESTINATION_CHAIN_ID,
            address(governance),
            GUARDIAN,
            IRescueWETH(address(weth)),
            IRescueERC20(address(pairedToken)),
            ILiquidityRescueSeeder(address(seeder)),
            address(custodian),
            100 ether,
            10 ether,
            uint64(block.timestamp + 7 days)
        );
    }

    function deployVaultFor(uint256 chainId) external returns (RMTLiquidityRescueVault) {
        return new RMTLiquidityRescueVault(
            chainId,
            address(governance),
            GUARDIAN,
            IRescueWETH(address(weth)),
            IRescueERC20(address(pairedToken)),
            ILiquidityRescueSeeder(address(seeder)),
            address(custodian),
            100 ether,
            10 ether,
            uint64(block.timestamp + 7 days)
        );
    }

    function _configureSourceAndAdapter(uint256 cap) private {
        vm.prank(address(governance));
        vault.configureSourceChain(SOURCE_CHAIN_ID, cap, true);
        vm.prank(address(governance));
        vault.configureIntakeAdapter(address(adapter), SOURCE_CHAIN_ID, true);
    }

    function _fundPairedToken(uint256 amount) private {
        pairedToken.mint(address(governance), amount);
        vm.prank(address(governance));
        pairedToken.approve(address(vault), amount);
        vm.prank(address(governance));
        vault.fundPairedToken(amount);
    }
}
