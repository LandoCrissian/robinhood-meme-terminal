// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {IGraduationAdapter} from "../src/interfaces/IGraduationAdapter.sol";

interface V6MarketVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory logs);
}

contract V6MarketFeeSink {
    uint256 public received;

    receive() external payable { revert("not a fee deposit"); }

    function deposit() external payable {
        received += msg.value;
    }
}

contract V6MarketGraduationAdapter is IGraduationAdapter {
    address public constant POOL = address(0xB0A7);
    uint256 public ethReceived;
    uint256 public tokensReceived;
    mapping(address token => bytes32 poolId) public poolIds;
    mapping(address token => address market) public markets;

    function prepare(address token) external returns (bytes32 poolId) {
        poolId = keccak256(abi.encode("V6_OVERSHOOT_POOL", token));
        poolIds[token] = poolId;
    }

    function bindMarket(address token, address market) external {
        require(poolIds[token] != bytes32(0), "pool not prepared");
        markets[token] = market;
    }

    function graduate(address token, uint256 tokenAmount) external payable returns (address pool, uint256 liquidity) {
        require(markets[token] == msg.sender, "wrong market");
        require(FixedSupplyMemeToken(token).transferFrom(msg.sender, address(this), tokenAmount), "token transfer");
        ethReceived += msg.value;
        tokensReceived += tokenAmount;
        return (POOL, tokenAmount);
    }
}

contract V6RefundPayer {
    uint8 public immutable refundMode;

    constructor(uint8 refundMode_) {
        refundMode = refundMode_;
    }

    function buy(CloneBondingCurveMarketV6 market, uint256 minimumTokensOut) external payable {
        market.buy{value: msg.value}(address(this), minimumTokensOut, block.timestamp);
    }

    function claim(CloneBondingCurveMarketV6 market, address payable recipient) external returns (uint256) {
        return market.claimPendingRefund(recipient);
    }

    receive() external payable {
        if (refundMode == 1) revert("refund rejected");
        if (refundMode == 2) {
            assembly {
                invalid()
            }
        }
    }
}

contract V6ForceEth {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract CloneBondingCurveMarketV6Test {
    V6MarketVm private constant vm = V6MarketVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    uint256 private constant VIRTUAL_ETH = 0.3 ether;
    uint256 private constant VIRTUAL_TOKENS = 1_017_500_000 ether;
    uint256 private constant TARGET = 2 ether;
    uint16 private constant FEE_BPS = 100;
    address private constant BUYER = address(0xB0B);
    bytes32 private constant TRADE_TOPIC = keccak256(
        "Trade(address,address,bool,uint256,uint256,uint256,uint256,uint256,uint256)"
    );

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 1_000 ether);
    }

    function testFinalBuyRefundsEOAAndEmitsOnlyAcceptedGrossAndFee() public {
        (CloneBondingCurveMarketV6 market,, V6MarketFeeSink sink,) = _deployMarket();
        uint256 sent = 3 ether;
        (uint256 quotedTokens, uint256 accepted, uint256 fee, uint256 refund) = market.quoteBuyExecution(sent);
        require(accepted - fee == TARGET, "quote does not land on target");
        require(fee == _fee(accepted), "fee floor changed");
        require(refund == sent - accepted, "wrong quote refund");

        vm.deal(BUYER, sent);
        vm.recordLogs();
        vm.prank(BUYER);
        uint256 tokensOut = market.buy{value: sent}(BUYER, quotedTokens, block.timestamp);

        require(tokensOut == quotedTokens, "execution quote mismatch");
        require(BUYER.balance == refund, "EOA not refunded immediately");
        require(market.realEthReserve() == TARGET, "target overshot");
        require(address(market).balance == TARGET, "market balance overshot");
        require(sink.received() == fee, "wrong fee forwarded");
        require(market.totalPendingRefunds() == 0, "EOA refund deferred");
        _assertTradeLog(market, tokensOut, accepted, fee);
    }

    function testRejectingRefundIsClaimableAndNeverMigratedWithForcedSurplus() public {
        (CloneBondingCurveMarketV6 market, FixedSupplyMemeToken token,, V6MarketGraduationAdapter adapter) =
            _deployMarket();

        (uint256 firstTokens,) = market.quoteBuy(1 ether);
        market.buy{value: 1 ether}(address(this), firstTokens, block.timestamp);
        uint256 forcedTokens = firstTokens / 4;
        require(forcedTokens != 0, "zero forced tokens");

        (uint256 quoteBeforeForce, uint256 feeBeforeForce) = market.quoteBuy(0.1 ether);
        uint256 trackedBeforeForce = market.trackedTokenInventory();
        token.transfer(address(market), forcedTokens);
        uint256 forcedEth = 0.4 ether;
        new V6ForceEth{value: forcedEth}().force(payable(address(market)));
        (uint256 quoteAfterForce, uint256 feeAfterForce) = market.quoteBuy(0.1 ether);
        require(quoteAfterForce == quoteBeforeForce && feeAfterForce == feeBeforeForce, "forced assets changed price");
        require(market.trackedTokenInventory() == trackedBeforeForce, "forced tokens became inventory");

        V6RefundPayer payer = new V6RefundPayer(1);
        uint256 sent = 2 ether;
        (uint256 finalTokens,, uint256 finalFee, uint256 refund) = market.quoteBuyExecution(sent);
        payer.buy{value: sent}(market, finalTokens);
        require(market.graduated(), "rejecting payer blocked graduation");
        require(market.pendingRefunds(address(payer)) == refund, "refund not deferred");
        require(market.realEthReserve() == TARGET, "wrong final reserve");
        require(finalFee == _fee(sent - refund), "wrong accepted fee");

        uint256 trackedTokens = market.trackedTokenInventory();
        market.migrateLiquidity();
        require(adapter.ethReceived() == TARGET, "forced/refund ETH migrated");
        require(adapter.tokensReceived() == trackedTokens, "forced tokens migrated");
        require(market.retainedEthSurplus() == forcedEth, "ETH surplus not recorded");
        require(market.retainedTokenSurplus() == forcedTokens, "token surplus not recorded");
        require(address(market).balance == forcedEth + refund, "wrong retained ETH");
        require(token.balanceOf(address(market)) == forcedTokens, "wrong retained tokens");

        uint256 recipientBalance = address(this).balance;
        payer.claim(market, payable(address(this)));
        require(address(this).balance == recipientBalance + refund, "deferred refund not claimable");
        require(address(market).balance == forcedEth, "claim consumed forced surplus");
        require(market.totalPendingRefunds() == 0, "pending total not cleared");
    }

    function testGasBurningRefundCannotBlockBuyAndCanBeRoutedOnClaim() public {
        (CloneBondingCurveMarketV6 market,,,) = _deployMarket();
        V6RefundPayer payer = new V6RefundPayer(2);
        uint256 sent = 3 ether;
        (uint256 tokensOut,,, uint256 refund) = market.quoteBuyExecution(sent);

        payer.buy{value: sent}(market, tokensOut);
        require(market.graduated(), "gas-burning refund blocked buy");
        require(market.pendingRefunds(address(payer)) == refund, "burner refund not deferred");

        uint256 recipientBalance = address(this).balance;
        payer.claim(market, payable(address(this)));
        require(address(this).balance == recipientBalance + refund, "burner refund not routed");
        require(address(market).balance == TARGET, "claim touched reserve");
    }

    function testSellProceedsCannotBeMisreportedAsMarketFees() public {
        (CloneBondingCurveMarketV6 market, FixedSupplyMemeToken token, V6MarketFeeSink sink,) = _deployMarket();
        (uint256 tokensOut,) = market.quoteBuy(1 ether);
        market.buy{value: 1 ether}(address(this), tokensOut, block.timestamp);
        uint256 accountedFees = sink.received();
        uint256 tokensToSell = tokensOut / 2;
        require(token.approve(address(market), tokensToSell), "market approval");

        (bool success,) = address(market).call(
            abi.encodeCall(
                market.sell,
                (tokensToSell, 0, payable(address(sink)), block.timestamp)
            )
        );

        require(!success, "seller proceeds entered fee sink");
        require(sink.received() == accountedFees, "seller proceeds inflated fee total");
        require(token.balanceOf(address(this)) == tokensOut, "failed sell moved tokens");
    }

    function testDeferredRefundCannotBeMisreportedAsMarketFees() public {
        (CloneBondingCurveMarketV6 market,, V6MarketFeeSink sink,) = _deployMarket();
        V6RefundPayer payer = new V6RefundPayer(1);
        uint256 sent = 3 ether;
        (uint256 tokensOut,,, uint256 refund) = market.quoteBuyExecution(sent);
        payer.buy{value: sent}(market, tokensOut);
        uint256 accountedFees = sink.received();

        (bool success,) = address(payer).call(
            abi.encodeCall(payer.claim, (market, payable(address(sink))))
        );

        require(!success, "refund entered fee sink");
        require(market.pendingRefunds(address(payer)) == refund, "failed claim consumed refund");
        require(sink.received() == accountedFees, "refund inflated fee total");
    }

    function testFuzzExactGraduationBoundaryPreservesFeeFloor(uint96 rawFirstGross) public {
        (CloneBondingCurveMarketV6 market,,, V6MarketGraduationAdapter adapter) = _deployMarket();
        uint256 maximumFirstGross = _grossForNet(TARGET - 1);
        uint256 firstGross = 1 + (uint256(rawFirstGross) % maximumFirstGross);
        (uint256 firstTokens, uint256 firstFee) = market.quoteBuy(firstGross);
        market.buy{value: firstGross}(address(this), firstTokens, block.timestamp);

        uint256 remaining = TARGET - market.realEthReserve();
        uint256 exactGross = _grossForNet(remaining);
        (uint256 finalTokens, uint256 accepted, uint256 finalFee, uint256 refund) =
            market.quoteBuyExecution(exactGross);
        require(accepted == exactGross && refund == 0, "exact boundary altered");
        require(finalFee == _fee(exactGross), "floor fee mismatch");
        require(accepted - finalFee == remaining, "gross-up not exact");

        vm.deal(BUYER, exactGross);
        vm.prank(BUYER);
        market.buy{value: exactGross}(BUYER, finalTokens, block.timestamp);
        require(market.realEthReserve() == TARGET, "exact boundary missed");
        require(address(market).balance == TARGET, "exact boundary balance");
        require(adapter.ethReceived() == 0, "migration happened inside buy");
        require(firstFee + finalFee < firstGross + exactGross, "invalid fees");
    }

    function testFuzzGraduationOvershootAlwaysRefundsExactExcess(uint96 rawFirstGross, uint96 rawExcess) public {
        (CloneBondingCurveMarketV6 market,,, V6MarketGraduationAdapter adapter) = _deployMarket();
        uint256 maximumFirstGross = _grossForNet(TARGET - 1);
        uint256 firstGross = 1 + (uint256(rawFirstGross) % maximumFirstGross);
        (uint256 firstTokens,) = market.quoteBuy(firstGross);
        market.buy{value: firstGross}(address(this), firstTokens, block.timestamp);

        uint256 remaining = TARGET - market.realEthReserve();
        uint256 exactGross = _grossForNet(remaining);
        uint256 excess = 1 + (uint256(rawExcess) % 5 ether);
        uint256 sent = exactGross + excess;
        (uint256 finalTokens, uint256 accepted, uint256 fee, uint256 refund) = market.quoteBuyExecution(sent);
        require(accepted == exactGross && refund == excess, "overshoot quote mismatch");
        require(fee == _fee(accepted) && accepted - fee == remaining, "overshoot fee mismatch");

        vm.deal(BUYER, sent);
        vm.prank(BUYER);
        market.buy{value: sent}(BUYER, finalTokens, block.timestamp);
        require(BUYER.balance == excess, "wrong immediate excess refund");
        require(market.realEthReserve() == TARGET, "fuzz overshoot reserve");
        require(address(market).balance == TARGET, "fuzz overshoot balance");
        require(market.totalPendingRefunds() == 0, "fuzz EOA refund deferred");
        require(adapter.ethReceived() == 0, "migration happened inside buy");
    }

    function testRejectsUnreachableGraduationTarget() public {
        require(!_initializeCandidate(18 ether), "unreachable target accepted");
    }

    function testRejectsGraduationLeavingLessThanOnePercentInventory() public {
        require(!_initializeCandidate(11 ether), "near-empty migration accepted");
    }

    function testRejectsCurveToPoolPriceDiscontinuityAboveFiftyBps() public {
        require(!_initializeCandidate(1 ether), "discontinuous target accepted");
    }

    function _deployMarket()
        private
        returns (
            CloneBondingCurveMarketV6 market,
            FixedSupplyMemeToken token,
            V6MarketFeeSink sink,
            V6MarketGraduationAdapter adapter
        )
    {
        token = new FixedSupplyMemeToken("V6 Boundary", "V6B", SUPPLY, address(this), address(this), "");
        sink = new V6MarketFeeSink();
        adapter = new V6MarketGraduationAdapter();
        market = new CloneBondingCurveMarketV6();
        bytes32 poolId = adapter.prepare(address(token));
        _initialize(market, token, sink, adapter, poolId, TARGET);
        adapter.bindMarket(address(token), address(market));
        token.transfer(address(market), SUPPLY);
    }

    function _initializeCandidate(uint256 target) private returns (bool success) {
        FixedSupplyMemeToken token =
            new FixedSupplyMemeToken("V6 Candidate", "V6C", SUPPLY, address(this), address(this), "");
        V6MarketFeeSink sink = new V6MarketFeeSink();
        V6MarketGraduationAdapter adapter = new V6MarketGraduationAdapter();
        CloneBondingCurveMarketV6 market = new CloneBondingCurveMarketV6();
        bytes32 poolId = adapter.prepare(address(token));
        (success,) = address(market).call(
            abi.encodeCall(
                market.initialize,
                (
                    address(token),
                    payable(address(sink)),
                    address(adapter),
                    poolId,
                    keccak256("V6_BOUNDARY_POLICY"),
                    1,
                    FEE_BPS,
                    VIRTUAL_ETH,
                    VIRTUAL_TOKENS,
                    target,
                    false,
                    0,
                    0,
                    0,
                    0
                )
            )
        );
    }

    function _initialize(
        CloneBondingCurveMarketV6 market,
        FixedSupplyMemeToken token,
        V6MarketFeeSink sink,
        V6MarketGraduationAdapter adapter,
        bytes32 poolId,
        uint256 target
    ) private {
        market.initialize(
            address(token),
            payable(address(sink)),
            address(adapter),
            poolId,
            keccak256("V6_BOUNDARY_POLICY"),
            1,
            FEE_BPS,
            VIRTUAL_ETH,
            VIRTUAL_TOKENS,
            target,
            false,
            0,
            0,
            0,
            0
        );
    }

    function _assertTradeLog(CloneBondingCurveMarketV6 market, uint256 tokensOut, uint256 accepted, uint256 fee)
        private
    {
        V6MarketVm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(market) || logs[i].topics.length == 0 || logs[i].topics[0] != TRADE_TOPIC) {
                continue;
            }
            (
                uint256 emittedTokens,
                uint256 emittedEth,
                uint256 emittedFee,
                uint256 emittedVirtualEth,
                uint256 emittedVirtualTokens,
                uint256 emittedRealEth
            ) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint256));
            require(emittedTokens == tokensOut, "event token amount");
            require(emittedEth == accepted, "event accepted ETH");
            require(emittedFee == fee, "event accepted fee");
            require(emittedVirtualEth == market.virtualEthReserve(), "event virtual ETH");
            require(emittedVirtualTokens == market.virtualTokenReserve(), "event virtual tokens");
            require(emittedRealEth == TARGET, "event real ETH");
            return;
        }
        revert("Trade event missing");
    }

    function _fee(uint256 gross) private pure returns (uint256) {
        return (gross * FEE_BPS) / 10_000;
    }

    function _grossForNet(uint256 net) private pure returns (uint256) {
        return net + ((net - 1) * FEE_BPS) / (10_000 - FEE_BPS);
    }
}
