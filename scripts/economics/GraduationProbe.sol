// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Read by eth_call on a loopback fork. The hypothetical project and pool disappear
// when the call returns. Nothing in this file is part of a protocol deployment.
interface Factory {
    function create(string memory, string memory, string memory, address, uint16, bytes32, uint256)
        external
        payable
        returns (address, Curve);
}

interface Curve {
    function quoteBuy(uint256) external view returns (uint256, uint256, uint256, uint256);
    function quoteSell(uint256) external view returns (uint256, uint256, uint256);
    function buy(uint256, uint256) external payable returns (uint256);
    function sell(uint256, uint256, uint256) external returns (uint256);
    function graduate(uint256) external;
    function graduated() external view returns (bool);
    function sold() external view returns (uint256);
    function backingReserve() external view returns (uint256);
    function nativeDust() external view returns (uint256);
    function tokenDust() external view returns (uint256);
    function revenueLedger() external view returns (address);
    function graduationEngine() external view returns (Engine);
    function poolId() external view returns (bytes32);
}

interface Engine {
    function positions(address) external view returns (uint256, uint128);
    function positionManager() external view returns (Manager);
}

interface Manager {
    function ownerOf(uint256) external view returns (address);
    function getApproved(uint256) external view returns (address);
    function getPositionLiquidity(uint256) external view returns (uint128);
}

interface StateView {
    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24);
}

interface Token {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface Ledger {
    function bucketAccrued(uint256) external view returns (uint256);
}

contract GraduationProbe {
    receive() external payable {}

    struct Fill {
        uint256 tokens;
        uint256 gross;
        uint256 fee;
        uint256 refund;
    }

    struct Result {
        address token;
        address curve;
        bytes code;
        bytes32[] getterWords;
        Fill[] buys;
        uint256[3] sellBack;
        uint256 backingAfterSell;
        Fill refill;
        bool eligibleBeforeGraduate;
        bytes32 poolId;
        uint256 positionId;
        uint128 liquidity;
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 poolFee;
        uint256 nativeDust;
        uint256 tokenDust;
        address lpOwner;
        uint256[4] feeBuckets;
    }

    function run(Factory factory, StateView stateView, bytes4[] calldata getters, uint256[] calldata budgets)
        external
        returns (Result memory r)
    {
        Curve c;
        (r.token, c) = factory.create{value: 0.0004 ether}(
            "Economics rehearsal", "ECON", "", address(0), 0, keccak256("isolated economics rehearsal"), block.timestamp
        );
        r.curve = address(c);
        r.code = address(c).code;
        r.getterWords = new bytes32[](getters.length);
        for (uint256 i; i < getters.length; i++) {
            (bool ok, bytes memory result) = address(c).staticcall(abi.encodeWithSelector(getters[i]));
            require(ok && result.length == 32, "curve getter");
            r.getterWords[i] = abi.decode(result, (bytes32));
        }
        r.buys = new Fill[](budgets.length);
        for (uint256 i; i < budgets.length; i++) {
            (r.buys[i].tokens, r.buys[i].gross, r.buys[i].fee, r.buys[i].refund) = c.quoteBuy(budgets[i]);
        }
        c.buy{value: 3 ether}(600_000_000 ether, block.timestamp);
        require(
            c.sold() == 600_000_000 ether && c.backingReserve() == 2 ether && !c.graduated(), "terminal ordinary buy"
        );
        (r.sellBack[0], r.sellBack[1], r.sellBack[2]) = c.quoteSell(100_000_000 ether);
        require(Token(r.token).approve(address(c), 100_000_000 ether));
        require(c.sell(100_000_000 ether, r.sellBack[0], block.timestamp) == r.sellBack[0]);
        r.backingAfterSell = c.backingReserve();
        (r.refill.tokens, r.refill.gross, r.refill.fee, r.refill.refund) = c.quoteBuy(1 ether);
        c.buy{value: 1 ether}(r.refill.tokens, block.timestamp);
        r.eligibleBeforeGraduate = c.sold() == 600_000_000 ether && c.backingReserve() == 2 ether && !c.graduated();
        c.graduate(block.timestamp);
        require(c.graduated() && c.backingReserve() == 0);
        r.poolId = c.poolId();
        (r.sqrtPriceX96, r.tick,, r.poolFee) = stateView.getSlot0(r.poolId);
        Engine engine = c.graduationEngine();
        (r.positionId, r.liquidity) = engine.positions(r.token);
        Manager manager = engine.positionManager();
        r.lpOwner = manager.ownerOf(r.positionId);
        require(r.lpOwner == address(engine) && manager.getApproved(r.positionId) == address(0));
        require(r.liquidity > 0 && manager.getPositionLiquidity(r.positionId) == r.liquidity);
        r.nativeDust = c.nativeDust();
        r.tokenDust = c.tokenDust();
        require(address(c).balance == r.nativeDust && Token(r.token).balanceOf(address(c)) == r.tokenDust);
        for (uint256 i; i < 4; i++) {
            r.feeBuckets[i] = Ledger(c.revenueLedger()).bucketAccrued(i);
        }
    }
}
