// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {LaunchRewardVault} from "../src/LaunchRewardVault.sol";
import {MemeLaunchFactory} from "../src/MemeLaunchFactory.sol";
import {IGraduationAdapter} from "../src/interfaces/IGraduationAdapter.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface FactoryTestVm {
    function deal(address account, uint256 balance) external;
}

contract ZeroReservationAdapter is IGraduationAdapter {
    function prepare(address) external pure returns (bytes32) {
        return bytes32(0);
    }

    function bindMarket(address, address) external pure {}

    function graduate(address, uint256) external payable returns (address, uint256) {
        return (address(0), 0);
    }
}

contract FactoryTestDeployer {
    function deploy(address adapter, uint16 feeBps, uint256 virtualEth, uint256 virtualTokens, uint256 target)
        external
        returns (MemeLaunchFactory)
    {
        return new MemeLaunchFactory(adapter, feeBps, virtualEth, virtualTokens, target);
    }
}

contract MemeLaunchFactoryTest {
    FactoryTestVm private constant vm = FactoryTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MemeLaunchFactory private factory;
    MockGraduationAdapter private adapter;
    address[4] private recipients = [address(0xBEEF), address(0xCAFE), address(0xD00D), address(0xF00D)];

    uint16 private constant MARKET_FEE_BPS = 100;
    uint256 private constant VIRTUAL_ETH_RESERVE = 30 ether;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_073_000_000 ether;
    uint256 private constant GRADUATION_TARGET = 85 ether;

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 100 ether);
        adapter = new MockGraduationAdapter();
        factory = new MemeLaunchFactory(
            address(adapter), MARKET_FEE_BPS, VIRTUAL_ETH_RESERVE, VIRTUAL_TOKEN_RESERVE, GRADUATION_TARGET
        );
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
        require(created.graduationPoolId != bytes32(0), "pool reservation not stored");
        require(adapter.markets(tokenAddress) == marketAddress, "adapter market not bound");
        require(address(market.token()) == tokenAddress, "market token");
        require(market.rewardVault() == payable(vaultAddress), "market vault");
        require(address(market.graduationAdapter()) == factory.graduationAdapter(), "market adapter");
        require(market.graduationPoolId() == created.graduationPoolId, "market pool reservation");
        require(market.feeBps() == factory.MARKET_FEE_BPS(), "market fee");
        require(vault.recipients(0) == address(this), "creator recipient");
        require(vault.recipients(1) == recipients[0], "community recipient");
    }

    function testEachLaunchAtomicallyReservesUniquePool() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (address firstToken,,) = factory.launch("First", "ONE", 1_000_000_000 ether, "", recipients, split);
        (address secondToken,,) = factory.launch("Second", "TWO", 1_000_000_000 ether, "", recipients, split);

        bytes32 firstPool = factory.getLaunch(0).graduationPoolId;
        bytes32 secondPool = factory.getLaunch(1).graduationPoolId;
        require(firstPool == adapter.poolIds(firstToken), "first pool mismatch");
        require(secondPool == adapter.poolIds(secondToken), "second pool mismatch");
        require(firstPool != secondPool, "pool reservation reused");
    }

    function testRejectsDuplicateNameIgnoringAsciiCase() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        factory.launch("Popular Meme", "FIRST", 1_000_000_000 ether, "", recipients, split);
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launch, ("popular meme", "SECOND", 1_000_000_000 ether, "", recipients, split))
        );
        require(!success, "duplicate name accepted");
    }

    function testRejectsDuplicateSymbolIgnoringAsciiCase() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        factory.launch("Original", "VAMP", 1_000_000_000 ether, "", recipients, split);
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launch, ("Copy", "vamp", 1_000_000_000 ether, "", recipients, split))
        );
        require(!success, "duplicate symbol accepted");
    }

    function testRejectsZeroPoolReservation() public {
        MemeLaunchFactory invalidFactory = new MemeLaunchFactory(
            address(new ZeroReservationAdapter()),
            MARKET_FEE_BPS,
            VIRTUAL_ETH_RESERVE,
            VIRTUAL_TOKEN_RESERVE,
            GRADUATION_TARGET
        );
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (bool success,) = address(invalidFactory)
            .call(abi.encodeCall(invalidFactory.launch, ("Invalid", "BAD", 1_000_000_000 ether, "", recipients, split)));
        require(!success, "zero pool reservation accepted");
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

    function testAdapterRejectsGraduationFromUnboundCaller() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (address tokenAddress,,) = factory.launch("Bound", "BND", 1_000_000_000 ether, "", recipients, split);

        (bool success,) = address(adapter).call{value: 1 wei}(abi.encodeCall(adapter.graduate, (tokenAddress, 0)));
        require(!success, "unbound caller graduated pool");
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

    function testRejectsNonstandardSupply() public {
        uint16[5] memory split = [uint16(3000), 2500, 1500, 1500, 1500];
        (bool success,) = address(factory)
            .call(abi.encodeCall(factory.launch, ("Wrong Supply", "WRONG", 500_000_000 ether, "", recipients, split)));
        require(!success, "nonstandard supply accepted");
    }

    function testMarketConfigurationIsImmutablePerFactory() public view {
        require(factory.MARKET_FEE_BPS() == MARKET_FEE_BPS, "fee configuration");
        require(factory.INITIAL_VIRTUAL_ETH_RESERVE() == VIRTUAL_ETH_RESERVE, "virtual ETH configuration");
        require(factory.INITIAL_VIRTUAL_TOKEN_RESERVE() == VIRTUAL_TOKEN_RESERVE, "virtual token configuration");
        require(factory.GRADUATION_TARGET() == GRADUATION_TARGET, "graduation configuration");
    }

    function testRejectsInvalidMarketConfiguration() public {
        FactoryTestDeployer deployer = new FactoryTestDeployer();
        (bool zeroTarget,) = address(deployer)
            .call(
                abi.encodeCall(
                    deployer.deploy, (address(adapter), MARKET_FEE_BPS, VIRTUAL_ETH_RESERVE, VIRTUAL_TOKEN_RESERVE, 0)
                )
            );
        require(!zeroTarget, "zero graduation target accepted");

        (bool undersizedVirtualInventory,) = address(deployer)
            .call(
                abi.encodeCall(
                    deployer.deploy,
                    (address(adapter), MARKET_FEE_BPS, VIRTUAL_ETH_RESERVE, factory.TOKEN_SUPPLY(), GRADUATION_TARGET)
                )
            );
        require(!undersizedVirtualInventory, "undersized virtual inventory accepted");
    }
}
