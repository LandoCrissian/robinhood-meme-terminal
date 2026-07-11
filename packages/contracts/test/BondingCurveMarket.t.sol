// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {IGraduationAdapter} from "../src/interfaces/IGraduationAdapter.sol";

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

contract MockGraduationAdapter is IGraduationAdapter {
    address public constant POOL = address(0xB0A7);
    uint256 public ethReceived;
    uint256 public tokensReceived;

    function graduate(address token, uint256 tokenAmount) external payable returns (address pool, uint256 liquidity) {
        FixedSupplyMemeToken(token).transferFrom(msg.sender, address(this), tokenAmount);
        ethReceived += msg.value;
        tokensReceived += tokenAmount;
        return (POOL, tokenAmount);
    }
}

contract ReentrantSeller {
    BondingCurveMarket private immutable market;
    FixedSupplyMemeToken private immutable token;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(BondingCurveMarket market_, FixedSupplyMemeToken token_) {
        market = market_;
        token = token_;
    }

    function sellAll() external {
        uint256 balance = token.balanceOf(address(this));
        token.approve(address(market), balance);
        market.sell(balance, 0, payable(address(this)), block.timestamp);
    }

    receive() external payable {
        reentryAttempted = true;
        (reentrySucceeded,) =
            address(market).call{value: 1}(abi.encodeCall(market.buy, (address(this), 0, block.timestamp)));
    }
}

contract BondingCurveMarketTest {
    MarketTestVm private constant vm = MarketTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FixedSupplyMemeToken private token;
    BondingCurveMarket private market;
    RewardSink private rewards;
    MockGraduationAdapter private adapter;
    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant MARKET_INVENTORY = 800_000_000 ether;
    uint256 private constant MIN_FUZZ_BUY = 1_000_000_000_000;
    uint256 private constant MAX_FUZZ_BUY = 5 ether;

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 100 ether);
        token = new FixedSupplyMemeToken("Market Test", "MKT", TOTAL_SUPPLY, address(this), address(this), "");
        rewards = new RewardSink();
        adapter = new MockGraduationAdapter();
        market = new BondingCurveMarket(
            address(token), payable(address(rewards)), address(adapter), 100, 30 ether, 1_073_000_000 ether, 85 ether
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
        _assertRoundTripCannotProfit(2 ether);
    }

    function testFuzzBuyThenSellCannotCreateProfit(uint96 rawAmount) public {
        uint256 amount = MIN_FUZZ_BUY + (uint256(rawAmount) % (MAX_FUZZ_BUY - MIN_FUZZ_BUY));
        _assertRoundTripCannotProfit(amount);
    }

    function testFuzzBuyAccountingConservesEth(uint96 rawAmount) public {
        uint256 amount = MIN_FUZZ_BUY + (uint256(rawAmount) % (MAX_FUZZ_BUY - MIN_FUZZ_BUY));
        (, uint256 expectedFee) = market.quoteBuy(amount);
        market.buy{value: amount}(address(this), 0, block.timestamp);
        require(rewards.received() == expectedFee, "fee mismatch");
        require(market.realEthReserve() == amount - expectedFee, "reserve mismatch");
        require(address(market).balance == market.realEthReserve(), "balance mismatch");
        require(address(market).balance + address(rewards).balance == amount, "eth not conserved");
    }

    function testRejectsExpiredDeadline() public {
        vm.warp(100);
        (bool success,) = address(market).call{value: 1 ether}(abi.encodeCall(market.buy, (address(this), 0, 99)));
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
        (bool success,) = address(market)
            .call(abi.encodeCall(market.sell, (100_000_000 ether, 0, payable(address(this)), block.timestamp)));
        require(!success, "insolvent sell accepted");
    }

    function testSellRecipientCannotReenter() public {
        ReentrantSeller attacker = new ReentrantSeller(market, token);
        market.buy{value: 2 ether}(address(attacker), 0, block.timestamp);

        attacker.sellAll();

        require(attacker.reentryAttempted(), "reentry not attempted");
        require(!attacker.reentrySucceeded(), "reentry succeeded");
        require(market.realEthReserve() == address(market).balance, "reserve mismatch");
    }

    function testGraduationIsIrreversibleAndStopsTrading() public {
        BondingCurveMarket graduatingMarket = new BondingCurveMarket(
            address(token), payable(address(rewards)), address(adapter), 100, 30 ether, 1_073_000_000 ether, 0.99 ether
        );
        token.transfer(address(graduatingMarket), 100_000_000 ether);

        graduatingMarket.buy{value: 1 ether}(address(this), 0, block.timestamp);

        require(graduatingMarket.graduated(), "market did not graduate");
        require(graduatingMarket.progressBps() == 10_000, "progress not complete");

        (bool buySucceeded,) = address(graduatingMarket).call{value: 1 ether}(
            abi.encodeCall(graduatingMarket.buy, (address(this), 0, block.timestamp))
        );
        require(!buySucceeded, "buy accepted after graduation");

        token.approve(address(graduatingMarket), 1 ether);
        (bool sellSucceeded,) = address(graduatingMarket)
            .call(abi.encodeCall(graduatingMarket.sell, (1 ether, 0, payable(address(this)), block.timestamp)));
        require(!sellSucceeded, "sell accepted after graduation");
        require(graduatingMarket.graduated(), "graduation reversed");
    }

    function testGraduationOvershootRemainsFullyAccounted() public {
        BondingCurveMarket graduatingMarket = new BondingCurveMarket(
            address(token), payable(address(rewards)), address(adapter), 100, 30 ether, 1_073_000_000 ether, 1 ether
        );
        token.transfer(address(graduatingMarket), 100_000_000 ether);

        graduatingMarket.buy{value: 2 ether}(address(this), 0, block.timestamp);

        require(graduatingMarket.graduated(), "market did not graduate");
        require(graduatingMarket.realEthReserve() == 1.98 ether, "overshoot reserve lost");
        require(address(graduatingMarket).balance == 1.98 ether, "balance mismatch");
    }

    function testGraduatedMarketMigratesAllAssetsExactlyOnce() public {
        BondingCurveMarket graduatingMarket = new BondingCurveMarket(
            address(token), payable(address(rewards)), address(adapter), 100, 30 ether, 1_073_000_000 ether, 0.99 ether
        );
        token.transfer(address(graduatingMarket), 100_000_000 ether);
        graduatingMarket.buy{value: 1 ether}(address(this), 0, block.timestamp);
        uint256 remainingInventory = token.balanceOf(address(graduatingMarket));

        (address pool, uint256 liquidity) = graduatingMarket.migrateLiquidity();

        require(pool == adapter.POOL(), "wrong pool");
        require(liquidity == remainingInventory, "wrong liquidity result");
        require(graduatingMarket.liquidityMigrated(), "migration not recorded");
        require(graduatingMarket.realEthReserve() == 0, "reserve not cleared");
        require(address(graduatingMarket).balance == 0, "eth retained");
        require(token.balanceOf(address(graduatingMarket)) == 0, "tokens retained");
        require(adapter.ethReceived() == 0.99 ether, "adapter eth mismatch");
        require(adapter.tokensReceived() == remainingInventory, "adapter token mismatch");

        (bool success,) = address(graduatingMarket).call(abi.encodeCall(graduatingMarket.migrateLiquidity, ()));
        require(!success, "second migration accepted");
    }

    function testCannotMigrateBeforeGraduation() public {
        (bool success,) = address(market).call(abi.encodeCall(market.migrateLiquidity, ()));
        require(!success, "early migration accepted");
    }

    function testProgressTracksRealReserve() public {
        market.buy{value: 1 ether}(address(this), 0, block.timestamp);
        uint256 netReserve = 990_000_000_000_000_000;
        uint256 targetReserve = 85_000_000_000_000_000_000;
        uint256 expectedProgress = (netReserve * 10_000) / targetReserve;
        require(market.progressBps() == expectedProgress, "wrong progress");
    }

    function _assertRoundTripCannotProfit(uint256 amount) private {
        uint256 startingEth = address(this).balance;
        (uint256 quote,) = market.quoteBuy(amount);
        uint256 bought = market.buy{value: amount}(address(this), quote, block.timestamp);
        token.approve(address(market), bought);
        (uint256 sellQuote,,) = market.quoteSell(bought);
        market.sell(bought, sellQuote, payable(address(this)), block.timestamp);
        require(address(this).balance < startingEth, "profitable round trip");
        require(market.realEthReserve() == address(market).balance, "reserve mismatch");
    }
}
