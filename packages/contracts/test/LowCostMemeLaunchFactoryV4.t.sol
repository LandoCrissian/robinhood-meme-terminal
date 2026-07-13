// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LowCostMemeLaunchFactoryV4} from "../src/LowCostMemeLaunchFactoryV4.sol";
import {ProtocolRevenueRouter} from "../src/ProtocolRevenueRouter.sol";
import {CloneBondingCurveMarketV2} from "../src/clone/CloneBondingCurveMarketV2.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface V4FactoryVm {
    function deal(address account, uint256 balance) external;
    function roll(uint256 blockNumber) external;
}

contract RewardsControllerMock {}

contract ForcedEthSender {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract LowCostMemeLaunchFactoryV4Test {
    V4FactoryVm private constant vm = V4FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address[5] private flywheelDestinations =
        [address(0x1001), address(0x1002), address(0x1003), address(0x1004), address(0x1005)];

    ProtocolRevenueRouter private router;
    RewardsControllerMock private controller;
    LowCostMemeLaunchFactoryV4 private factory;

    function setUp() public {
        vm.deal(address(this), 20 ether);
        router = new ProtocolRevenueRouter(flywheelDestinations);
        controller = new RewardsControllerMock();
        factory = new LowCostMemeLaunchFactoryV4(
            address(new MockGraduationAdapter()),
            100,
            0.3 ether,
            1_073_000_000 ether,
            1 ether,
            address(controller),
            address(router)
        );
    }

    function testSimplePresetUsesApprovedFlywheelSplit() public {
        (address token, address market, address rewardVault) =
            factory.launchSimple("Simple Launch", "SIMPLE", "ipfs://simple");

        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        require(vault.recipients(0) == address(this) && vault.rewardBps(0) == 7_000, "creator split");
        require(vault.recipients(4) == address(router) && vault.rewardBps(4) == 3_000, "router split");
        require(
            CloneBondingCurveMarketV2(payable(market)).token().balanceOf(market) == factory.TOKEN_SUPPLY(),
            "market inventory"
        );
        require(factory.getLaunch(0).token == token, "launch record");
    }

    function testCommunityPresetUsesAutomaticPurposeVaults() public {
        (address token,, address rewardVault) =
            factory.launchCommunity("Community Launch", "COMM", "ipfs://community");
        (address community, address trader) = factory.communityDestinationsForToken(token);
        require(community != address(0) && trader != address(0), "purpose vaults");

        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        require(vault.rewardBps(0) == 4_000, "creator");
        require(vault.recipients(1) == community && vault.rewardBps(1) == 2_000, "community");
        require(vault.recipients(2) == trader && vault.rewardBps(2) == 1_000, "trader");
        require(vault.rewardBps(3) == 0, "graduation is not a fee recipient");
        require(vault.recipients(4) == address(router) && vault.rewardBps(4) == 3_000, "flywheel");
    }

    function testRejectsVampingAcrossCaseAndSeparators() public {
        factory.launchSimple("Doge Coin", "DOGE", "");

        (bool duplicateName,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("doge-coin", "OTHER", "")));
        require(!duplicateName, "separator vamp accepted");

        (bool duplicateSymbol,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("Original Name", "doge", "")));
        require(!duplicateSymbol, "symbol vamp accepted");
    }

    function testRejectsUnicodeSymbolsAndOversizedMetadata() public {
        (bool unicodeName,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, (unicode"Ｄoge", "VALID", "")));
        require(!unicodeName, "unicode lookalike accepted");

        (bool invalidSymbol,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("Valid Name", "BAD-SYM", "")));
        require(!invalidSymbol, "punctuated symbol accepted");

        string memory oversized = string(new bytes(513));
        (bool longMetadata,) =
            address(factory).call(abi.encodeCall(factory.launchSimple, ("Another Name", "VALID2", oversized)));
        require(!longMetadata, "oversized metadata accepted");
    }

    function testFairStartIsAutomaticAndTemporary() public {
        (, address marketAddress,) = factory.launchSimple("Fair Start", "FAIR", "");
        CloneBondingCurveMarketV2 market = CloneBondingCurveMarketV2(payable(marketAddress));
        (uint256 smallTokens,) = market.quoteBuy(0.001 ether);

        (bool beforeOpen,) = address(market).call{value: 0.001 ether}(
            abi.encodeCall(market.buy, (address(this), smallTokens, block.timestamp))
        );
        require(!beforeOpen, "trading opened early");

        vm.roll(market.tradingOpensAtBlock());
        market.buy{value: 0.001 ether}(address(this), smallTokens, block.timestamp);

        (bool sameBlock,) = address(market).call{value: 0.001 ether}(
            abi.encodeCall(market.buy, (address(this), 0, block.timestamp))
        );
        require(!sameBlock, "same-block burst accepted");

        (uint256 oversizedTokens,) = market.quoteBuy(0.0016 ether);
        vm.roll(block.number + 1);
        (bool oversized,) = address(market).call{value: 0.0016 ether}(
            abi.encodeCall(market.buy, (address(this), oversizedTokens, block.timestamp))
        );
        require(!oversized, "early transaction cap bypassed");

        vm.roll(market.fairStartEndsAtBlock());
        (uint256 unrestrictedTokens,) = market.quoteBuy(0.01 ether);
        market.buy{value: 0.01 ether}(address(0xCAFE), unrestrictedTokens, block.timestamp);
        require(market.fairStartPurchased(address(0xCAFE)) == 0, "expired protection changed accounting");
    }

    function testForcedEthCannotBlockGraduationOrBeWithdrawn() public {
        (address token, address marketAddress,) = factory.launchSimple("Forced ETH", "FORCE", "");
        CloneBondingCurveMarketV2 market = CloneBondingCurveMarketV2(payable(marketAddress));

        vm.roll(market.fairStartEndsAtBlock());
        (uint256 tokensOut,) = market.quoteBuy(1.1 ether);
        market.buy{value: 1.1 ether}(address(this), tokensOut, block.timestamp);
        require(market.graduated(), "market did not graduate");

        uint256 trackedReserve = market.realEthReserve();
        uint256 forcedAmount = 0.123 ether;
        ForcedEthSender sender = new ForcedEthSender{value: forcedAmount}();
        sender.force(payable(marketAddress));
        require(address(market).balance == trackedReserve + forcedAmount, "forced eth missing");

        uint256 remainingInventory = market.token().balanceOf(marketAddress);
        market.migrateLiquidity();

        MockGraduationAdapter adapter = MockGraduationAdapter(factory.graduationAdapter());
        require(adapter.ethReceived() == trackedReserve + forcedAmount, "surplus not locked as liquidity");
        require(adapter.tokensReceived() == remainingInventory, "inventory not migrated");
        require(address(market).balance == 0, "market retained eth");
        require(market.realEthReserve() == 0, "tracked reserve not cleared");
        require(market.liquidityMigrated(), "migration not recorded");
        require(market.token().balanceOf(marketAddress) == 0, "market retained tokens");
        require(token != address(0), "token missing");
    }

    function testProtocolRevenueCanBePermissionlesslyCollected() public {
        (, address marketAddress, address rewardVault) =
            factory.launchSimple("Revenue Launch", "REV", "");
        CloneBondingCurveMarketV2 market = CloneBondingCurveMarketV2(payable(marketAddress));

        vm.roll(market.fairStartEndsAtBlock());
        (uint256 tokensOut,) = market.quoteBuy(1.1 ether);
        market.buy{value: 1.1 ether}(address(this), tokensOut, block.timestamp);

        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(rewardVault));
        uint256 routerShare = vault.claimable(address(router));
        require(routerShare == 0.0033 ether, "wrong router accrual");

        router.collect(rewardVault);
        require(router.totalReceived() == routerShare, "router collection");
        require(market.realEthReserve() == 1.089 ether, "graduation reserve diverted");
    }

    receive() external payable {}
}
