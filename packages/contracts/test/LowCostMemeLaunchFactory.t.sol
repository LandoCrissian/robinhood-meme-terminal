// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarket} from "../src/clone/CloneBondingCurveMarket.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {CloneLaunchRewardVault} from "../src/clone/CloneLaunchRewardVault.sol";
import {LowCostMemeLaunchFactory} from "../src/LowCostMemeLaunchFactory.sol";
import {MockGraduationAdapter} from "./BondingCurveMarket.t.sol";

interface LowCostFactoryVm {
    function deal(address account, uint256 balance) external;
}

contract LowCostMemeLaunchFactoryTest {
    LowCostFactoryVm private constant vm =
        LowCostFactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    LowCostMemeLaunchFactory private factory;
    address[4] private recipients = [address(0xBEEF), address(0xCAFE), address(0xD00D), address(0xF00D)];
    uint16[5] private split = [uint16(3000), 2500, 1500, 1500, 1500];

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 10 ether);
        factory = new LowCostMemeLaunchFactory(
            address(new MockGraduationAdapter()), 100, 30 ether, 1_073_000_000 ether, 1 ether
        );
    }

    function testLowCostLaunchCreatesCloneTokenAndVaultWithMarketCustody() public {
        (address tokenAddress, address marketAddress, address vaultAddress) =
            factory.launch("Cheap Launch", "CHEAP", "ipfs://cheap", recipients, split);

        CloneFixedSupplyMemeToken token = CloneFixedSupplyMemeToken(tokenAddress);
        CloneLaunchRewardVault vault = CloneLaunchRewardVault(payable(vaultAddress));
        CloneBondingCurveMarket market = CloneBondingCurveMarket(payable(marketAddress));

        require(token.totalSupply() == factory.TOKEN_SUPPLY(), "wrong supply");
        require(token.balanceOf(marketAddress) == factory.TOKEN_SUPPLY(), "market lacks inventory");
        require(token.balanceOf(address(this)) == 0, "creator received hidden inventory");
        require(vault.recipients(0) == address(this), "creator reward recipient wrong");
        require(address(market.token()) == tokenAddress, "market token wrong");

        (bool reinitialized,) = address(market).call(
            abi.encodeCall(
                market.initialize,
                (
                    tokenAddress,
                    payable(vaultAddress),
                    factory.graduationAdapter(),
                    factory.getLaunch(0).graduationPoolId,
                    factory.marketFeeBps(),
                    factory.initialVirtualEthReserve(),
                    factory.initialVirtualTokenReserve(),
                    factory.graduationTarget()
                )
            )
        );
        require(!reinitialized, "market reinitialized");

        (uint256 tokensOut, uint256 fee) = market.quoteBuy(0.1 ether);
        market.buy{value: 0.1 ether}(address(this), tokensOut, block.timestamp);
        require(vault.totalReceived() == fee, "trade fee missed vault");
    }

    function testLowCostFactoryRejectsVamping() public {
        factory.launch("Protected", "SAFE", "", recipients, split);
        (bool duplicateName,) = address(factory).call(
            abi.encodeCall(factory.launch, ("protected", "OTHER", "", recipients, split))
        );
        (bool duplicateSymbol,) = address(factory).call(
            abi.encodeCall(factory.launch, ("Other", "safe", "", recipients, split))
        );
        require(!duplicateName, "duplicate name accepted");
        require(!duplicateSymbol, "duplicate symbol accepted");
    }
}
