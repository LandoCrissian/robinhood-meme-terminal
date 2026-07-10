// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";

interface MarketTestVm {
    function deal(address account, uint256 balance) external;
    function warp(uint256 timestamp) external;
}

contract RewardSink {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}

contract BondingCurveMarketTest {
    MarketTestVm private constant vm =
        MarketTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FixedSupplyMemeToken private token;
    BondingCurveMarket private market;
    RewardSink private rewards;

    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant MARKET_INVENTORY = 800_000_000 ether;

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 100 ether);
        token = new FixedSupplyMemeToken("Market Test", "MKT", TOTAL_SUPPLY, address(this), "");
        rewards = new RewardSink();
        market = new BondingCurveMarket(
            address(token), payable(address(rewards)), 100, 30 ether, 1_073_000_000 ether, 85 ether
        );
        token.transfer(address(market), MARKET_INVENTORY);
    }

    function testBuyMovesInventoryAndPaysOnePercentFee() public {
        (uint256 quote, uint256 fee) = market.quoteBuy(1 ether);
        require(quote > 0, "zero quote");
        require(fee == 0.01 ether, "wrong fee");

        uint256 bought = market.buy{value: 1 ether}(address(this), quote, block.timestamp);

        require(bought == quote, "quote mismatch");
        require(token.balanceOf(address(this)) == TOTAL_SUPPLY - MARKET_INVENTORY + quote, "buyer balance");
        require(market.realEthReserve() == 0.99 ether, "real reserve");
        require(rewards.received() == 0.01 ether, "fee not forwarded");
        require(address(market).balance == 0.99 ether, "market balance");
    }

    function testBuyThenSellCannotCreateProfit() public {
        uint256 startingEth = address(this).balance;
        (uint256 quote,) = market.quoteBuy(2 ether);
        uint256 bought = market.buy{value: 2 ether}(address(this), quote, block.timestamp);

        token.approve(address(market), bought);
        (uint256 sellQuote,,) = market.quoteSell(bought);
        market.sell(bought, sellQuote, payable(address(this)), block.timestamp);

        require(address(this).balance < startingEth, "profitable round trip");
        require(market.realEthReserve() == address(market).balance, "reserve mismatch");
    }

    function testRejectsExpiredDeadline() public {
        vm.warp(100);
        (bool success,) = address(market).call{value: 1 ether}(
            abi.encodeCall(market.buy, (address(this), 0, 99))
        );
        require(!success, "expired buy accepted");
    }

    function testRejectsBuySlippage() public {
        (uint256 quote,) = market.quoteBuy(1 ether);
        (bool success,) = address(market).call{value: 1 ether}(
            abi.encodeCall(market.buy, (address(this), quote + 1, block.timestamp))
        );
        require(!success, "slippage ignored");
    }

    function testCannotSellBeyondRealReserve() public {
        token.approve(address(market), 100_000_000 ether);
        (bool success,) = address(market).call(
            abi.encodeCall(market.sell, (100_000_000 ether, 0, payable(address(this)), block.timestamp))
        );
        require(!success, "insolvent sell accepted");
    }

    function testProgressTracksRealReserve() public {
        market.buy{value: 1 ether}(address(this), 0, block.timestamp);
        require(market.progressBps() == (0.99 ether * 10_000) / 85 ether, "wrong progress");
    }
}
