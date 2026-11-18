// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolPins} from "project-treasury/src/TreasuryInterfaces.sol";
import {RMTProjectTreasuryV1} from "project-treasury/src/RMTProjectTreasuryV1.sol";
import {RMTProjectTreasuryFactoryV1} from "project-treasury/src/RMTProjectTreasuryFactoryV1.sol";
import {TreasuryCoreMock, TreasuryEngineMock, TreasuryCurveMock, TreasuryPositionsMock} from "project-treasury/test/TreasuryMocks.sol";

interface DispositionVm {
    function chainId(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function etch(address, bytes calldata) external;
}

/// @dev COUNTERFACTUAL TEST ONLY. This configurable token is not the approved
/// TokenV2 and cannot pass its production runtime hash. A deliberately synthetic
/// factory pin tests exact-delta/guard defenses even if that admission premise
/// is broken. It does not demonstrate a reachable deployed-token exploit.
contract DispositionFaultToken {
    uint256 public constant totalSupply = 1_000_000_000 ether;
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    // 0 normal, 1 recipient short-credit, 2 sender over-debit, 3 false,
    // 4 malformed returndata, 5 guarded callback followed by normal transfer.
    uint8 public fault;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    constructor() { balanceOf[msg.sender] = totalSupply; }
    function configure(uint8 value, address target, bytes calldata data) external {
        fault = value; callbackTarget = target; callbackData = data;
        callbackAttempted = false; callbackSucceeded = false;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) { return _transfer(msg.sender, to, amount); }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount; return _transfer(from, to, amount);
    }
    function _transfer(address from, address to, uint256 amount) private returns (bool) {
        if (fault == 5) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        balanceOf[from] -= amount + (fault == 2 ? 1 : 0);
        balanceOf[to] += amount - (fault == 1 ? 1 : 0);
        if (fault == 4) { assembly ("memory-safe") { mstore(0, 1) return(0, 1) } }
        return fault != 3;
    }
}

/// @dev Another explicit counterfactual: the pinned production engine creates
/// the fixed LP ledger. This mutable mock tests rollback for a misbehaving
/// ledger, not admission of a real replacement ledger or third-party engine.
contract DispositionFaultLedger {
    address public creator;
    address public treasury;
    uint16 public treasuryShareBps = 2250;
    address public constant operatingRecipient = address(0x900001);
    address public constant futureReserveRecipient = address(0x900002);
    address public engine;
    DispositionFaultToken public token;
    uint256 public nativeCredit;
    uint256 public tokenCredit;
    uint8 public fault;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    constructor(address c, address t, address e, DispositionFaultToken asset) {
        creator = c; treasury = t; engine = e; token = asset;
    }
    function credit() external payable { nativeCredit += msg.value; }
    function creditToken(uint256 amount) external { tokenCredit += amount; }
    function configure(uint8 value) external { fault = value; }
    function claim() external returns (uint256 n, uint256 t) { return _claim(true, true); }
    function claimAsset(bool native) external returns (uint256 n, uint256 t) { return _claim(native, !native); }
    function _claim(bool native, bool erc20) private returns (uint256 n, uint256 t) {
        require(msg.sender == treasury, "beneficiary");
        n = native ? nativeCredit : 0; t = erc20 ? tokenCredit : 0;
        nativeCredit -= n; tokenCredit -= t;
        if (fault == 3) {
            callbackAttempted = true;
            (callbackSucceeded,) = treasury.call(abi.encodeCall(RMTProjectTreasuryV1.reconcile, (address(token))));
        }
        if (t != 0) require(token.transfer(treasury, t));
        if (n != 0) { (bool ok,) = payable(treasury).call{value: n}(""); require(ok); }
        if (fault == 1) t += 1; // Mismatched declared token payout.
        if (fault == 2) n += 1; // Mismatched declared native payout.
    }
}

contract V1SecurityDispositionTest {
    DispositionVm private constant vm = DispositionVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR = address(0x100001);
    address private constant RECIPIENT = address(0x100003);
    bytes32 private constant INTENT = keccak256("077-counterfactual-boundaries");
    uint256 private constant START = 1_800_000_000;
    TreasuryCoreMock private core;
    TreasuryEngineMock private engine;
    DispositionFaultToken private token;
    RMTProjectTreasuryV1 private treasury;
    DispositionFaultLedger private ledger;

    function setUp() public {
        vm.chainId(31337); vm.warp(START); vm.deal(address(this), 100 ether);
        core = new TreasuryCoreMock(); engine = new TreasuryEngineMock(address(core)); core.setEngine(address(engine));
        token = new DispositionFaultToken();
        ProtocolPins memory pins = ProtocolPins(address(core), address(core).codehash, address(engine), address(engine).codehash, address(token).codehash);
        RMTProjectTreasuryFactoryV1 factory = new RMTProjectTreasuryFactoryV1(pins);
        vm.prank(CREATOR); treasury = RMTProjectTreasuryV1(payable(factory.create(INTENT, CREATOR, 2250, type(RMTProjectTreasuryV1).creationCode)));
        TreasuryCurveMock curve = new TreasuryCurveMock(CREATOR, address(treasury), 2250, address(token), address(core), address(engine));
        core.register(CREATOR, INTENT, address(token), address(curve)); treasury.bindProject();
        ledger = new DispositionFaultLedger(CREATOR, address(treasury), address(engine), token);
        engine.setLedger(address(token), address(ledger)); token.approve(address(treasury), type(uint256).max);
    }

    function _fundToken() private { treasury.depositToken(address(token), 10 ether); }
    function _queueToken() private returns (uint64 id) {
        vm.prank(CREATOR); id = treasury.queueWithdrawal(address(token), RECIPIENT, 3 ether, uint48(START + 3 days));
        vm.warp(START + 2 days);
    }
    function _assertHeld(uint256 expected) private view {
        require(token.balanceOf(address(treasury)) == expected, "token balance");
        require(treasury.accountedHeld(address(token)) == expected, "accounting");
    }
    function _assertFailedWithdrawal(uint64 id, uint256 senderBefore, uint256 recipientBefore) private view {
        _assertHeld(10 ether);
        require(token.balanceOf(address(this)) == senderBefore && token.balanceOf(RECIPIENT) == recipientBefore, "rollback balances");
        (,,,,,,uint8 state) = treasury.withdrawals(id);
        require(state == 1 && treasury.reserved(address(token)) == 3 ether && treasury.pendingWithdrawals() == 1, "rollback reservation");
        (,,,,,uint256 withdrawn,) = treasury.totals(address(token)); require(withdrawn == 0, "no fabricated withdrawal");
    }

    // Slither 9c16c8... beforeBalance (line 214) protects actual incoming assets.
    function testDepositRecipientShortCreditRollsBackAllowanceBalancesAndAccounting() public {
        token.configure(1, address(0), ""); uint256 before = token.balanceOf(address(this)); uint256 approved = token.allowance(address(this), address(treasury));
        vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.depositToken(address(token), 2 ether);
        _assertHeld(0); require(token.balanceOf(address(this)) == before && token.allowance(address(this), address(treasury)) == approved);
    }
    // Slither e44f38... senderBefore (line 215) protects exact sender debit too.
    function testDepositUnexpectedSenderDebitRollsBackAllowanceBalancesAndAccounting() public {
        token.configure(2, address(0), ""); uint256 before = token.balanceOf(address(this)); uint256 approved = token.allowance(address(this), address(treasury));
        vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.depositToken(address(token), 2 ether);
        _assertHeld(0); require(token.balanceOf(address(this)) == before && token.allowance(address(this), address(treasury)) == approved);
    }
    function testDepositFalseOrMalformedReturnRollsBackEvenIfTokenMovedAssets() public {
        for (uint8 mode = 3; mode <= 4; mode++) {
            token.configure(mode, address(0), ""); uint256 before = token.balanceOf(address(this));
            vm.expectRevert(RMTProjectTreasuryV1.TransferFailed.selector); treasury.depositToken(address(token), 2 ether);
            _assertHeld(0); require(token.balanceOf(address(this)) == before);
        }
    }
    function testDepositCallbackCannotEnterReconciliationButNormalExactTransferCompletes() public {
        token.configure(5, address(treasury), abi.encodeCall(RMTProjectTreasuryV1.reconcile, (address(token))));
        treasury.depositToken(address(token), 2 ether);
        require(token.callbackAttempted() && !token.callbackSucceeded(), "guard rejects callback"); _assertHeld(2 ether);
    }
    // Slither 9c89e2... beforeTreasury (line 328), exact outgoing debit.
    function testWithdrawalUnexpectedTreasuryDebitRollsBackReservationAndTransfer() public {
        _fundToken(); uint64 id = _queueToken(); uint256 before = token.balanceOf(address(this)); uint256 recipient = token.balanceOf(RECIPIENT);
        token.configure(2, address(0), ""); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.executeWithdrawal(id);
        _assertFailedWithdrawal(id, before, recipient);
    }
    // Slither 3795d5... beforeRecipient (line 327), exact destination credit.
    function testWithdrawalRecipientShortCreditRollsBackReservationAndTransfer() public {
        _fundToken(); uint64 id = _queueToken(); uint256 before = token.balanceOf(address(this)); uint256 recipient = token.balanceOf(RECIPIENT);
        token.configure(1, address(0), ""); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.executeWithdrawal(id);
        _assertFailedWithdrawal(id, before, recipient);
    }
    function testWithdrawalCallbackCannotReplayConsumedRequest() public {
        _fundToken(); uint64 id = _queueToken();
        token.configure(5, address(treasury), abi.encodeCall(RMTProjectTreasuryV1.executeWithdrawal, (id)));
        treasury.executeWithdrawal(id); require(token.callbackAttempted() && !token.callbackSucceeded());
        _assertHeld(7 ether); require(token.balanceOf(RECIPIENT) == 3 ether && treasury.reserved(address(token)) == 0);
        vm.expectRevert(RMTProjectTreasuryV1.NoticeUnavailable.selector); treasury.executeWithdrawal(id);
    }
    function _creditLp() private {
        token.transfer(address(ledger), 8 ether); ledger.creditToken(8 ether); ledger.credit{value: 1 ether}();
    }
    function _assertLpRollback() private view {
        _assertHeld(0); require(treasury.accountedHeld(address(0)) == 0 && address(treasury).balance == 0);
        require(ledger.tokenCredit() == 8 ether && ledger.nativeCredit() == 1 ether && token.balanceOf(address(ledger)) == 8 ether);
        require(address(ledger).balance == 1 ether, "original credits remain claimable");
    }
    // Slither f0d7ab... claim() (line 196), reported payout must equal received.
    function testCombinedLpWrongTokenAmountRollsBackAllAssetsAndFeeCredits() public {
        _creditLp(); ledger.configure(1); vm.prank(CREATOR); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.claimLp(0); _assertLpRollback();
    }
    // Slither ce5b86... claimAsset() (line 197), same check in single-asset mode.
    function testSingleAssetLpWrongTokenAmountRollsBackAllAssetsAndFeeCredits() public {
        _creditLp(); ledger.configure(1); vm.prank(CREATOR); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.claimLp(2); _assertLpRollback();
    }
    function testLpWrongNativeAmountRollsBackReceiveAccountingAndClaimCredit() public {
        _creditLp(); ledger.configure(2); vm.prank(CREATOR); vm.expectRevert(RMTProjectTreasuryV1.UnsupportedAssetBehavior.selector); treasury.claimLp(0); _assertLpRollback();
    }
    function testLpCallbackCannotReenterWhileCorrectClaimAndPrincipalRemainValid() public {
        _creditLp(); ledger.configure(3); vm.prank(CREATOR); (uint256 n, uint256 t) = treasury.claimLp(0);
        require(n == 1 ether && t == 8 ether && ledger.callbackAttempted() && !ledger.callbackSucceeded()); _assertHeld(8 ether);
        require(treasury.accountedHeld(address(0)) == 1 ether && address(treasury).balance == 1 ether);
        (uint256 id, uint128 liquidity) = engine.positions(address(token));
        require(id == 1 && liquidity == 10000 && TreasuryPositionsMock(engine.positionManager()).owner() == address(engine));
    }
    function testChangedTokenRuntimeRejectedBeforeAnyNewDepositOrWithdrawal() public {
        _fundToken(); uint64 id = _queueToken(); vm.etch(address(token), hex"60006000fd");
        vm.expectRevert(RMTProjectTreasuryV1.InvalidAsset.selector); treasury.depositToken(address(token), 1);
        vm.expectRevert(RMTProjectTreasuryV1.InvalidAsset.selector); treasury.executeWithdrawal(id);
        require(treasury.accountedHeld(address(token)) == 10 ether && treasury.reserved(address(token)) == 3 ether);
    }
    function testFuzz_ExactDepositWithdrawWithBlockedCallbacksPreservesConservation(uint96 raw) public {
        uint256 amount = uint256(raw) % 1_000_000 ether + 10;
        token.configure(5, address(treasury), abi.encodeCall(RMTProjectTreasuryV1.reconcile, (address(token))));
        treasury.depositToken(address(token), amount); _assertHeld(amount);
        vm.prank(CREATOR); uint64 id = treasury.queueWithdrawal(address(token), RECIPIENT, amount / 2, uint48(START + 3 days));
        vm.warp(START + 2 days); treasury.executeWithdrawal(id);
        _assertHeld(amount - amount / 2); require(token.balanceOf(RECIPIENT) == amount / 2);
        (uint256 manual,,,,,uint256 withdrawn,) = treasury.totals(address(token)); require(manual == amount && withdrawn == amount / 2);
        require(treasury.reserved(address(token)) == 0 && !treasury.purchaseExecutionAvailable());
    }
}
