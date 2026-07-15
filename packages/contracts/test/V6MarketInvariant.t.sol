// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {IGraduationAdapter} from "../src/interfaces/IGraduationAdapter.sol";

interface V6MarketInvariantVm {
    function deal(address account, uint256 balance) external;
}

contract V6FixedTokenMock {
    uint256 public immutable totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "balance");
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
    }
}

contract V6FeeSplitterMock {
    uint256 public received;

    receive() external payable { revert("not a fee deposit"); }

    function deposit() external payable {
        received += msg.value;
    }
}

contract V6GraduationAdapterMock is IGraduationAdapter {
    address public constant POOL = address(0x600D);
    mapping(address token => bytes32 poolId) public poolIds;
    mapping(address token => address market) public markets;
    uint256 public ethReceived;
    uint256 public tokensReceived;

    function prepare(address token) external returns (bytes32 poolId) {
        poolId = keccak256(abi.encode("RMT_V6_INVARIANT_POOL", token));
        poolIds[token] = poolId;
    }

    function bindMarket(address token, address market) external {
        require(poolIds[token] != bytes32(0), "unprepared pool");
        require(markets[token] == address(0), "already bound");
        markets[token] = market;
    }

    function graduate(address token, uint256 tokenAmount)
        external
        payable
        returns (address pool, uint256 liquidity)
    {
        require(markets[token] == msg.sender, "unauthorized market");
        require(V6FixedTokenMock(token).transferFrom(msg.sender, address(this), tokenAmount), "token transfer");
        ethReceived += msg.value;
        tokensReceived += tokenAmount;
        return (POOL, tokenAmount);
    }
}

contract V6RefundActor {
    CloneBondingCurveMarketV6 public immutable market;
    V6FixedTokenMock public immutable token;
    uint8 private _refundFailureMode;

    constructor(CloneBondingCurveMarketV6 market_, V6FixedTokenMock token_) {
        market = market_;
        token = token_;
    }

    function buyWithFailedRefund(uint8 failureMode) external payable returns (uint256 tokensOut) {
        require(failureMode == 1 || failureMode == 2, "invalid mode");
        _refundFailureMode = failureMode;
        tokensOut = market.buy{value: msg.value}(address(this), 0, type(uint256).max);
        _refundFailureMode = 0;
    }

    function claim(address payable recipient) external returns (uint256 amount) {
        amount = market.claimPendingRefund(recipient);
    }

    function approveAndTryPostGraduationSell(uint256 amount) external returns (bool success) {
        token.approve(address(market), amount);
        (success,) = address(market).call(
            abi.encodeCall(market.sell, (amount, 0, payable(address(this)), type(uint256).max))
        );
    }

    receive() external payable {
        if (_refundFailureMode == 1) revert("refund rejected");
        if (_refundFailureMode == 2) {
            assembly {
                invalid()
            }
        }
    }
}

contract V6InvariantForceEth {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract V6MarketInvariantHandler {
    CloneBondingCurveMarketV6 public immutable market;
    V6FixedTokenMock public immutable token;
    V6FeeSplitterMock public immutable feeSplitter;
    V6GraduationAdapterMock public immutable adapter;
    V6RefundActor public immutable rejectingBuyer;

    uint256 public expectedFees;
    uint256 public expectedRealEthReserve;
    uint256 public expectedMigratedEth;
    bool public postGraduationTradeSucceeded;

    constructor(
        CloneBondingCurveMarketV6 market_,
        V6FixedTokenMock token_,
        V6FeeSplitterMock feeSplitter_,
        V6GraduationAdapterMock adapter_
    ) {
        market = market_;
        token = token_;
        feeSplitter = feeSplitter_;
        adapter = adapter_;
        rejectingBuyer = new V6RefundActor(market_, token_);
    }

    function buy(uint96 seed) external {
        if (market.graduated() || address(this).balance < 1_000_000_000) return;
        uint256 amount = 1_000_000_000 + (uint256(seed) % 0.25 ether);
        if (amount > address(this).balance) amount = address(this).balance;
        (uint256 tokensOut, uint256 acceptedEth, uint256 fee,) = market.quoteBuyExecution(amount);
        if (tokensOut == 0) return;

        try market.buy{value: amount}(address(this), 0, type(uint256).max) returns (uint256) {
            expectedFees += fee;
            expectedRealEthReserve += acceptedEth - fee;
            if (market.graduated()) _attemptPostGraduationTrades();
        } catch {}
    }

    function sell(uint96 seed) external {
        if (market.graduated()) return;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 1 + (uint256(seed) % balance);
        (uint256 ethOut, uint256 fee, uint256 grossEth) = market.quoteSell(amount);
        if (ethOut == 0 || grossEth > expectedRealEthReserve) return;

        token.approve(address(market), amount);
        try market.sell(amount, 0, payable(address(this)), type(uint256).max) returns (uint256) {
            expectedFees += fee;
            expectedRealEthReserve -= grossEth;
        } catch {}
    }

    function buyWithDeferredRefund(uint96 seed) external {
        if (market.graduated()) return;
        uint256 remaining = market.graduationTarget() - market.realEthReserve();
        uint256 amount = remaining + 1 ether + (uint256(seed) % 0.1 ether);
        if (amount > address(this).balance) return;
        (uint256 tokensOut, uint256 acceptedEth, uint256 fee, uint256 refund) =
            market.quoteBuyExecution(amount);
        if (tokensOut == 0 || refund == 0) return;

        try rejectingBuyer.buyWithFailedRefund{value: amount}(1) returns (uint256) {
            expectedFees += fee;
            expectedRealEthReserve += acceptedEth - fee;
            _attemptPostGraduationTrades();
        } catch {}
    }

    function claimDeferredRefund() external {
        if (market.pendingRefunds(address(rejectingBuyer)) == 0) return;
        rejectingBuyer.claim(payable(address(this)));
    }

    function migrate() external {
        if (!market.graduated() || market.liquidityMigrated()) return;
        uint256 reserve = expectedRealEthReserve;
        try market.migrateLiquidity() returns (address, uint256) {
            expectedMigratedEth += reserve;
            expectedRealEthReserve = 0;
        } catch {}
    }

    function attemptPostGraduationTrades() external {
        _attemptPostGraduationTrades();
    }

    function _attemptPostGraduationTrades() private {
        if (!market.graduated()) return;

        if (address(this).balance != 0) {
            (bool buySucceeded,) = address(market).call{value: 1}(
                abi.encodeCall(market.buy, (address(this), 0, type(uint256).max))
            );
            if (buySucceeded) postGraduationTradeSucceeded = true;
        }

        uint256 ownBalance = token.balanceOf(address(this));
        if (ownBalance != 0) {
            token.approve(address(market), ownBalance);
            (bool sellSucceeded,) = address(market).call(
                abi.encodeCall(market.sell, (ownBalance, 0, payable(address(this)), type(uint256).max))
            );
            if (sellSucceeded) postGraduationTradeSucceeded = true;
        }

        uint256 rejectingBuyerBalance = token.balanceOf(address(rejectingBuyer));
        if (rejectingBuyerBalance != 0) {
            bool actorSellSucceeded = rejectingBuyer.approveAndTryPostGraduationSell(rejectingBuyerBalance);
            if (actorSellSucceeded) postGraduationTradeSucceeded = true;
        }
    }

    receive() external payable {}
}

contract V6MarketInvariantTest {
    V6MarketInvariantVm private constant vm =
        V6MarketInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 0.3 ether;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_017_500_000 ether;
    uint256 private constant GRADUATION_TARGET = 2 ether;

    struct Fixture {
        V6FixedTokenMock token;
        V6FeeSplitterMock feeSplitter;
        V6GraduationAdapterMock adapter;
        CloneBondingCurveMarketV6 market;
    }

    Fixture private _stateful;
    V6MarketInvariantHandler private _handler;
    address[] private _targetedContracts;

    function setUp() public {
        vm.deal(address(this), 50_000 ether);
        _stateful = _deploy();
        _handler = new V6MarketInvariantHandler(
            _stateful.market, _stateful.token, _stateful.feeSplitter, _stateful.adapter
        );
        vm.deal(address(_handler), 200 ether);
        _targetedContracts.push(address(_handler));
    }

    /// @dev Foundry discovers this stateful-handler allowlist using the StdInvariant-compatible hook.
    function targetContracts() external view returns (address[] memory) {
        return _targetedContracts;
    }

    function testFuzzRandomizedBuySellConservation(uint96 rawBuyA, uint96 rawSell, uint96 rawBuyB) public {
        Fixture memory fixture = _deploy();
        uint256 startingEth = address(this).balance;
        uint256 buyA = _bound(rawBuyA, 1_000_000_000_000, 0.05 ether);
        uint256 buyB = _bound(rawBuyB, 1_000_000_000_000, 0.05 ether);

        (uint256 tokensA, uint256 acceptedA, uint256 buyFeeA, uint256 refundA) =
            fixture.market.quoteBuyExecution(buyA);
        uint256 boughtA = fixture.market.buy{value: buyA}(address(this), tokensA, type(uint256).max);
        require(refundA == 0 && acceptedA == buyA && boughtA == tokensA, "first buy quote");

        uint256 minimumSell = 1 ether;
        require(boughtA >= minimumSell, "insufficient fuzz buy");
        uint256 sellAmount = minimumSell + (uint256(rawSell) % (boughtA - minimumSell + 1));
        fixture.token.approve(address(fixture.market), sellAmount);
        (uint256 sellQuote, uint256 sellFee, uint256 grossSell) = fixture.market.quoteSell(sellAmount);
        uint256 soldFor = fixture.market.sell(sellAmount, sellQuote, payable(address(this)), type(uint256).max);
        require(soldFor == sellQuote, "sell quote");

        (uint256 tokensB, uint256 acceptedB, uint256 buyFeeB, uint256 refundB) =
            fixture.market.quoteBuyExecution(buyB);
        uint256 boughtB = fixture.market.buy{value: buyB}(address(this), tokensB, type(uint256).max);
        require(refundB == 0 && acceptedB == buyB && boughtB == tokensB, "second buy quote");

        uint256 expectedReserve = (acceptedA - buyFeeA) - grossSell + (acceptedB - buyFeeB);
        uint256 expectedInventory = TOTAL_SUPPLY - boughtA + sellAmount - boughtB;
        uint256 expectedFees = buyFeeA + sellFee + buyFeeB;

        require(fixture.market.realEthReserve() == expectedReserve, "reserve flow");
        require(address(fixture.market).balance == expectedReserve, "market eth conservation");
        require(fixture.feeSplitter.received() == expectedFees, "fee flow");
        require(fixture.market.trackedTokenInventory() == expectedInventory, "tracked inventory flow");
        require(fixture.token.balanceOf(address(fixture.market)) == expectedInventory, "actual inventory flow");
        require(fixture.token.balanceOf(address(fixture.market)) + fixture.token.balanceOf(address(this)) == TOTAL_SUPPLY, "token conservation");
        require(address(this).balance + address(fixture.market).balance + address(fixture.feeSplitter).balance == startingEth, "eth conservation");
        require(fixture.market.realEthReserve() <= fixture.market.graduationTarget(), "target exceeded");
    }

    function testFuzzRoundTripNeverProfits(uint96 rawBuy) public {
        Fixture memory fixture = _deploy();
        uint256 startingEth = address(this).balance;
        uint256 amount = _bound(rawBuy, 1_000_000_000_000, 0.05 ether);
        (uint256 tokensOut, uint256 buyFee) = fixture.market.quoteBuy(amount);
        fixture.market.buy{value: amount}(address(this), tokensOut, type(uint256).max);
        fixture.token.approve(address(fixture.market), tokensOut);
        (uint256 ethOut, uint256 sellFee,) = fixture.market.quoteSell(tokensOut);
        fixture.market.sell(tokensOut, ethOut, payable(address(this)), type(uint256).max);

        require(address(this).balance < startingEth, "profitable round trip");
        require(fixture.feeSplitter.received() == buyFee + sellFee, "round-trip fees");
        require(address(fixture.market).balance == fixture.market.realEthReserve(), "round-trip reserve");
        require(fixture.market.trackedTokenInventory() == TOTAL_SUPPLY, "round-trip tracked inventory");
        require(fixture.token.balanceOf(address(fixture.market)) == TOTAL_SUPPLY, "round-trip actual inventory");
        require(address(this).balance + address(fixture.market).balance + address(fixture.feeSplitter).balance == startingEth, "round-trip conservation");
    }

    function testGraduationBoundaryBelowAtAndAbove() public {
        Fixture memory probe = _deploy();
        (, uint256 boundaryGross,,) = probe.market.quoteBuyExecution(100 ether);
        require(boundaryGross > 1, "invalid boundary");

        Fixture memory below = _deploy();
        (, uint256 acceptedBelow, uint256 belowFee, uint256 belowRefund) =
            below.market.quoteBuyExecution(boundaryGross - 1);
        below.market.buy{value: boundaryGross - 1}(address(this), 0, type(uint256).max);
        require(belowRefund == 0 && acceptedBelow == boundaryGross - 1, "below boundary quote");
        require(!below.market.graduated(), "below boundary graduated");
        require(
            below.market.realEthReserve() == below.market.graduationTarget() - 1,
            "below boundary reserve"
        );
        require(below.feeSplitter.received() == belowFee, "below boundary fee");

        Fixture memory exact = _deploy();
        (,, uint256 exactFee, uint256 exactRefund) = exact.market.quoteBuyExecution(boundaryGross);
        exact.market.buy{value: boundaryGross}(address(this), 0, type(uint256).max);
        require(exactRefund == 0, "exact boundary refunded");
        require(exact.market.graduated(), "exact boundary did not graduate");
        require(exact.market.realEthReserve() == exact.market.graduationTarget(), "exact boundary reserve");
        require(exact.feeSplitter.received() == exactFee, "exact boundary fee");

        Fixture memory above = _deploy();
        (uint256 tokensOut, uint256 acceptedEth, uint256 aboveFee, uint256 aboveRefund) =
            above.market.quoteBuyExecution(boundaryGross + 1);
        above.market.buy{value: boundaryGross + 1}(address(this), tokensOut, type(uint256).max);
        require(acceptedEth == boundaryGross && aboveRefund == 1, "above boundary quote");
        require(above.market.graduated(), "above boundary did not graduate");
        require(above.market.realEthReserve() == above.market.graduationTarget(), "above target exceeded");
        require(address(above.market).balance == above.market.graduationTarget(), "successful refund retained");
        require(above.feeSplitter.received() == aboveFee, "above boundary fee");
    }

    function testHugeOverpayIsEntirelyDeferredWhenRefundIsRejected() public {
        Fixture memory fixture = _deploy();
        V6RefundActor actor = new V6RefundActor(fixture.market, fixture.token);
        uint256 overpay = 10_000 ether;
        (, uint256 acceptedEth, uint256 fee, uint256 refund) = fixture.market.quoteBuyExecution(overpay);

        actor.buyWithFailedRefund{value: overpay}(1);

        require(fixture.market.graduated(), "huge overpay did not graduate");
        require(fixture.market.realEthReserve() == fixture.market.graduationTarget(), "huge overpay target");
        require(fixture.market.pendingRefunds(address(actor)) == refund, "huge refund not credited");
        require(fixture.market.totalPendingRefunds() == refund, "huge refund total");
        require(address(fixture.market).balance == fixture.market.graduationTarget() + refund, "huge refund accounting");
        require(acceptedEth == fixture.market.graduationTarget() + fee, "accepted gross accounting");
        require(fixture.feeSplitter.received() == fee, "huge overpay fee");
        require(acceptedEth + refund == overpay, "overpay conservation");
    }

    function testGasBurningRefundReceiverIsDeferred() public {
        Fixture memory fixture = _deploy();
        V6RefundActor actor = new V6RefundActor(fixture.market, fixture.token);
        uint256 payment = 3 ether;
        (, uint256 acceptedEth, uint256 fee, uint256 refund) = fixture.market.quoteBuyExecution(payment);
        require(refund != 0, "missing test refund");

        actor.buyWithFailedRefund{value: payment}(2);

        require(fixture.market.pendingRefunds(address(actor)) == refund, "gas-burn refund not credited");
        require(fixture.market.totalPendingRefunds() == refund, "gas-burn refund total");
        require(address(fixture.market).balance == fixture.market.realEthReserve() + refund, "gas-burn accounting");
        require(fixture.market.realEthReserve() == acceptedEth - fee, "gas-burn reserve");
        require(fixture.feeSplitter.received() == fee, "gas-burn fee");
    }

    function testPendingRefundIsExcludedFromMigrationAndClaimableAfterward() public {
        Fixture memory fixture = _deploy();
        V6RefundActor actor = new V6RefundActor(fixture.market, fixture.token);
        uint256 payment = 3 ether;
        (,,, uint256 refund) = fixture.market.quoteBuyExecution(payment);
        actor.buyWithFailedRefund{value: payment}(1);
        uint256 inventory = fixture.market.trackedTokenInventory();

        fixture.market.migrateLiquidity();

        require(
            fixture.adapter.ethReceived() == fixture.market.graduationTarget(),
            "refund migrated as liquidity"
        );
        require(fixture.adapter.tokensReceived() == inventory, "tracked inventory migration");
        require(address(fixture.market).balance == refund, "refund not retained");
        require(fixture.market.totalPendingRefunds() == refund, "refund liability changed");
        require(fixture.market.realEthReserve() == 0, "migrated reserve not cleared");
        require(fixture.market.trackedTokenInventory() == 0, "migrated inventory not cleared");

        uint256 recipientBefore = address(this).balance;
        actor.claim(payable(address(this)));
        require(address(this).balance == recipientBefore + refund, "post-migration claim not paid");
        require(fixture.market.totalPendingRefunds() == 0, "post-migration liability not cleared");
        require(address(fixture.market).balance == 0, "post-migration refund retained");
    }

    function testForcedEthAndTokenSurplusAreNotMigrated() public {
        Fixture memory fixture = _deploy();
        fixture.market.buy{value: 3 ether}(address(this), 0, type(uint256).max);
        uint256 trackedInventory = fixture.market.trackedTokenInventory();
        uint256 forcedTokens = fixture.token.balanceOf(address(this)) / 10;
        uint256 forcedEth = 0.25 ether;
        fixture.token.transfer(address(fixture.market), forcedTokens);
        V6InvariantForceEth forceSender = new V6InvariantForceEth{value: forcedEth}();
        forceSender.force(payable(address(fixture.market)));

        fixture.market.migrateLiquidity();

        require(
            fixture.adapter.ethReceived() == fixture.market.graduationTarget(),
            "forced eth migrated"
        );
        require(fixture.adapter.tokensReceived() == trackedInventory, "forced tokens migrated");
        require(fixture.market.retainedEthSurplus() == forcedEth, "forced eth not recorded");
        require(fixture.market.retainedTokenSurplus() == forcedTokens, "forced tokens not recorded");
        require(address(fixture.market).balance == forcedEth, "forced eth not retained");
        require(fixture.token.balanceOf(address(fixture.market)) == forcedTokens, "forced tokens not retained");
    }

    function testPostGraduationBuyAndSellAlwaysRevert() public {
        Fixture memory fixture = _deploy();
        V6RefundActor actor = new V6RefundActor(fixture.market, fixture.token);
        actor.buyWithFailedRefund{value: 3 ether}(1);
        require(fixture.market.graduated(), "fixture not graduated");

        (bool buySucceeded,) = address(fixture.market).call{value: 1}(
            abi.encodeCall(fixture.market.buy, (address(this), 0, type(uint256).max))
        );
        bool sellSucceeded = actor.approveAndTryPostGraduationSell(
            fixture.token.balanceOf(address(actor))
        );

        require(!buySucceeded, "post-graduation buy succeeded");
        require(!sellSucceeded, "post-graduation sell succeeded");
    }

    function invariant_realReserveNeverExceedsGraduationTarget() public view {
        require(
            _stateful.market.realEthReserve() <= _stateful.market.graduationTarget(),
            "invariant: graduation target exceeded"
        );
        if (_stateful.market.graduated()) {
            require(_stateful.market.progressBps() == 10_000, "invariant: graduated progress");
            if (_stateful.market.liquidityMigrated()) {
                require(_stateful.market.realEthReserve() == 0, "invariant: migrated reserve");
            } else {
                require(
                    _stateful.market.realEthReserve() == _stateful.market.graduationTarget(),
                    "invariant: graduation boundary"
                );
            }
        }
    }

    function invariant_ethAndFeeAccountingIsConserved() public view {
        require(
            _stateful.market.realEthReserve() == _handler.expectedRealEthReserve(),
            "invariant: modeled reserve"
        );
        require(_stateful.feeSplitter.received() == _handler.expectedFees(), "invariant: modeled fees");
        require(
            address(_stateful.feeSplitter).balance == _stateful.feeSplitter.received(),
            "invariant: splitter balance"
        );
        require(
            address(_stateful.market).balance
                == _stateful.market.realEthReserve() + _stateful.market.totalPendingRefunds()
                    + _stateful.market.retainedEthSurplus(),
            "invariant: market eth liabilities"
        );
        require(_stateful.adapter.ethReceived() == _handler.expectedMigratedEth(), "invariant: migrated eth");
    }

    function invariant_inventoryTracksOnlyLegitimateFlows() public view {
        uint256 marketBalance = _stateful.token.balanceOf(address(_stateful.market));
        require(
            marketBalance
                == _stateful.market.trackedTokenInventory() + _stateful.market.retainedTokenSurplus(),
            "invariant: tracked token balance"
        );
        uint256 accountedSupply = marketBalance + _stateful.token.balanceOf(address(_handler))
            + _stateful.token.balanceOf(address(_handler.rejectingBuyer()))
            + _stateful.token.balanceOf(address(_stateful.adapter));
        require(accountedSupply == TOTAL_SUPPLY, "invariant: token conservation");
    }

    function invariant_pendingRefundsNeverBecomeLiquidity() public view {
        require(
            address(_stateful.market).balance >= _stateful.market.totalPendingRefunds(),
            "invariant: refund undercollateralized"
        );
        if (_stateful.market.liquidityMigrated()) {
            require(
                _stateful.adapter.ethReceived() == _stateful.market.graduationTarget(),
                "invariant: refund migrated"
            );
        }
    }

    function invariant_noPostGraduationTradeCanSucceed() public view {
        require(!_handler.postGraduationTradeSucceeded(), "invariant: post-graduation trade");
    }

    function invariant_curveRoundingNeverDropsBelowK() public view {
        require(
            _stateful.market.virtualEthReserve() * _stateful.market.virtualTokenReserve()
                >= _stateful.market.curveInvariantK(),
            "invariant: curve below k"
        );
    }

    function _deploy() private returns (Fixture memory fixture) {
        fixture.token = new V6FixedTokenMock(TOTAL_SUPPLY);
        fixture.feeSplitter = new V6FeeSplitterMock();
        fixture.adapter = new V6GraduationAdapterMock();
        fixture.market = new CloneBondingCurveMarketV6();
        bytes32 poolId = fixture.adapter.prepare(address(fixture.token));
        fixture.market.initialize(
            address(fixture.token),
            payable(address(fixture.feeSplitter)),
            address(fixture.adapter),
            poolId,
            keccak256("RMT_V6_INVARIANT_POLICY"),
            1,
            100,
            VIRTUAL_ETH_RESERVE,
            VIRTUAL_TOKEN_RESERVE,
            GRADUATION_TARGET,
            false,
            0,
            0,
            0,
            0
        );
        fixture.adapter.bindMarket(address(fixture.token), address(fixture.market));
        fixture.token.transfer(address(fixture.market), TOTAL_SUPPLY);
    }

    function _bound(uint96 raw, uint256 minimum, uint256 maximum) private pure returns (uint256) {
        return minimum + (uint256(raw) % (maximum - minimum + 1));
    }

    receive() external payable {}
}
