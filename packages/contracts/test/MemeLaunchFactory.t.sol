// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {LaunchRewardVault} from "../src/LaunchRewardVault.sol";
import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface FactoryTestVm {
    function deal(address account, uint256 balance) external;
}

contract MemeLaunchFactoryTest {
    FactoryTestVm private constant vm = FactoryTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MemeLaunchFactory private factory;
    address[4] private recipients = [address(0xBEEF), address(0xCAFE), address(0xD00D), address(0xF00D)];

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 100 ether);
        factory = new MemeLaunchFactory(address(new MockGraduationAdapter()));
    }

    function testLaunchCreatesTokenMarketAndRewardVault() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        uint256 supply = 1_000_000_000 ether;
        (address tokenAddress, address marketAddress, address vaultAddress) =
            factory.launch("Genesis", "GEN", supply, "ipfs://genesis", recipients, split);

        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);
        BondingCurveMarket market = BondingCurveMarket(payable(marketAddress));
        LaunchRewardVault vault = LaunchRewardVault(payable(vaultAddress));
        MemeLaunchFactory.Launch memory created = factory.getLaunch(0);

        require(factory.launchCount() == 1, "launch count");
        require(token.totalSupply() == supply, "supply");
        require(token.creator() == address(this), "creator identity");
        require(token.balanceOf(address(this)) == 0, "creator received inventory");
        require(token.balanceOf(marketAddress) == supply, "market missing inventory");
        require(token.balanceOf(address(factory)) == 0, "factory retained inventory");
        require(created.market == marketAddress, "market not stored");
        require(created.rewardVault == vaultAddress, "vault not stored");
        require(address(market.token()) == tokenAddress, "market token");
        require(market.rewardVault() == payable(vaultAddress), "market vault");
        require(address(market.graduationAdapter()) == factory.graduationAdapter(), "market adapter");
        require(market.feeBps() == factory.MARKET_FEE_BPS(), "market fee");
        require(vault.recipients(0) == address(this), "creator recipient");
        require(vault.recipients(1) == recipients[0], "community recipient");
    }

    function testIntegratedBuyFundsRewardVault() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (address tokenAddress, address marketAddress, address vaultAddress) =
            factory.launch("Trade", "TRD", 1_000_000_000 ether, "", recipients, split);

        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);
        BondingCurveMarket market = BondingCurveMarket(payable(marketAddress));
        LaunchRewardVault vault = LaunchRewardVault(payable(vaultAddress));
        (uint256 quote, uint256 fee) = market.quoteBuy(1 ether);
        market.buy{value: 1 ether}(address(this), quote, block.timestamp);

        require(token.balanceOf(address(this)) == quote, "tokens not delivered");
        require(market.realEthReserve() == 1 ether - fee, "reserve mismatch");
        require(vault.totalReceived() == fee, "vault not funded");
        require(vault.claimable(address(this)) == (fee * split[0]) / 10_000, "creator accrual");
    }

    function testRejectsInvalidRewardSplit() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1499];
        (bool success,) =
            address(factory).call(abi.encodeCall(factory.launch, ("Bad Split", "BAD", 1 ether, "", recipients, split)));
        require(!success, "invalid split accepted");
    }

    function testRejectsZeroSupply() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (bool success,) =
            address(factory).call(abi.encodeCall(factory.launch, ("Zero", "ZERO", 0, "", recipients, split)));
        require(!success, "zero supply accepted");
    }
}
