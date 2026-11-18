// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract TreasuryTokenMock {
    uint256 public constant totalSupply = 1_000_000_000 ether;
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor() { balanceOf[msg.sender] = totalSupply; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}
contract TreasuryHostileTokenMock {
    uint256 public constant totalSupply = 1_000_000_000 ether;
    uint8 public constant decimals = 18;
    function balanceOf(address) external pure returns (uint256) { return type(uint256).max; }
    function transfer(address, uint256) external pure returns (bool) { return false; }
}
contract TreasuryCoreMock {
    address public graduationEngine;
    address public constant operatingRecipient = address(0x900001);
    address public constant futureReserveRecipient = address(0x900002);
    mapping(address => mapping(bytes32 => address)) public tokenForIntent;
    mapping(address => address) public originCurveForToken;
    function setEngine(address e) external { graduationEngine = e; }
    function register(address creator, bytes32 intent, address token, address curve) external { tokenForIntent[creator][intent] = token; originCurveForToken[token] = curve; }
}
contract TreasuryLedgerMock {
    address public creator; address public treasury; uint16 public treasuryShareBps;
    address public constant operatingRecipient = address(0x900001);
    address public constant futureReserveRecipient = address(0x900002);
    address public engine; address public token;
    uint256 public nativeCredit; uint256 public tokenCredit;
    bool public rejectClaim;
    constructor(address c, address t, uint16 s, address e, address token_) { creator=c; treasury=t; treasuryShareBps=s; engine=e; token=token_; }
    function credit() external payable { nativeCredit += msg.value; }
    function creditToken(uint256 amount) external { tokenCredit += amount; }
    function setReject(bool value) external { rejectClaim = value; }
    function claim() external returns (uint256 n, uint256 t) { return _claim(true,true); }
    function claimAsset(bool native) external returns (uint256 n, uint256 t) { return _claim(native,!native); }
    function _claim(bool native, bool erc20) private returns (uint256 n,uint256 t) {
        require(msg.sender == treasury && !rejectClaim, "recipient or interrupted");
        n = native ? nativeCredit : 0; t = erc20 ? tokenCredit : 0;
        nativeCredit -= n; tokenCredit -= t;
        if (t != 0) TreasuryTokenMock(token).transfer(msg.sender,t);
        if (n != 0) { (bool ok,) = payable(msg.sender).call{value:n}(""); require(ok); }
    }
}
contract TreasuryCurveMock {
    address public creator; address public treasury; uint16 public treasuryShareBps;
    address public revenueLedger; address public token; address public factory; address public graduationEngine;
    constructor(address c,address t,uint16 s,address token_,address f,address e) {
        creator=c;treasury=t;treasuryShareBps=s;token=token_;factory=f;graduationEngine=e;
        revenueLedger=address(new TreasuryLedgerMock(c,t,s,e,token_));
    }
}
contract TreasuryPositionsMock {
    address public owner; uint128 public liquidity=10000; address public approved;
    function configure(address o,uint128 l,address a) external { owner=o;liquidity=l;approved=a; }
    function ownerOf(uint256) external view returns(address) { return owner; }
    function getApproved(uint256) external view returns(address) { return approved; }
    function getPositionLiquidity(uint256) external view returns(uint128) { return liquidity; }
}
contract TreasuryEngineMock {
    address public factory; address public positionManager; bytes32 public positionManagerRuntimeHash;
    mapping(address=>address) public lpFeeLedger;
    constructor(address f) { factory=f; TreasuryPositionsMock p=new TreasuryPositionsMock();p.configure(address(this),10000,address(0));positionManager=address(p);positionManagerRuntimeHash=address(p).codehash; }
    function positions(address token) external view returns(uint256,uint128) { return lpFeeLedger[token]==address(0)?(0,0):(1,10000); }
    function setLedger(address token,address ledger) external { lpFeeLedger[token]=ledger; }
    function collectLpFees(address,uint256) external pure returns(uint256,uint256) { return (0,0); }
}
contract TreasuryRejectReceiverMock { receive() external payable { revert("reject native"); } }
interface ITreasuryWithdrawal { function executeWithdrawal(uint64 id) external; }
contract TreasuryCallbackReceiverMock {
    address public target; uint64 public request; bool public attacked;
    function configure(address t,uint64 id) external { target=t;request=id; }
    receive() external payable { (bool ok,) = target.call(abi.encodeCall(ITreasuryWithdrawal.executeWithdrawal,(request))); attacked=ok; }
}
