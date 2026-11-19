// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SeaportAcquisitionBase} from "./SeaportAcquisition.t.sol";
import {IGenuineSafe, IGenuineSafeFactory} from "./SeaportAcquisitionSafe.t.sol";
import {RMTSeaportAcquisitionVaultV2 as Vault} from "../src/RMTSeaportAcquisitionVaultV2.sol";
import {SeaportAcquisitionTypes as T} from "../src/SeaportAcquisitionTypes.sol";

/// @dev Synthetic hostile callback probes only. No production keys or route.
contract Task084Probe {
    Vault internal target;
    bytes[] private probes;
    uint256 public attempts;
    uint256 public successes;
    uint256 public unexpectedError;
    function configureProbe(Vault next) external {
        target = next;
        T.AdvancedOrder memory order;
        order.parameters.offer = new T.OfferItem[](0);
        order.parameters.consideration = new T.ConsiderationItem[](0);
        order.numerator = 1;
        order.denominator = 1;
        T.Request memory request;
        probes.push(abi.encodeCall(Vault.purchase,(order,request)));
        probes.push(abi.encodeCall(Vault.executeWithdrawal,(uint64(1))));
        probes.push(abi.encodeCall(Vault.cancelWithdrawal,(uint64(1))));
        probes.push(abi.encodeCall(Vault.acceptController,()));
        probes.push(abi.encodeCall(Vault.cancelController,()));
    }
    function _probe() internal {
        if (address(target) == address(0)) return;
        for (uint256 i; i < probes.length; i++) {
            attempts++;
            (bool ok, bytes memory reason) = address(target).call(probes[i]);
            if (ok) successes++;
            bytes4 selector;
            if (reason.length >= 4) assembly ("memory-safe") { selector := mload(add(reason,32)) }
            if (selector != Vault.ReentrantCall.selector) unexpectedError++;
        }
    }
    function assertAllBlocked() external view {
        require(attempts >= 5 && attempts % 5 == 0 && successes == 0 && unexpectedError == 0,"EXACT_REENTRANCY_GUARD");
    }
}
contract Task084Currency is Task084Probe {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 amount);
    event Approval(address indexed owner,address indexed spender,uint256 amount);
    constructor() { balanceOf[msg.sender] = 100 ether; }
    function approve(address spender,uint256 amount) external returns (bool) {
        _probe(); allowance[msg.sender][spender] = amount; emit Approval(msg.sender,spender,amount); return true;
    }
    function transfer(address to,uint256 amount) external returns (bool) { _probe(); _move(msg.sender,to,amount); return true; }
    function transferFrom(address from,address to,uint256 amount) external returns (bool) {
        _probe(); allowance[from][msg.sender] -= amount; _move(from,to,amount); return true;
    }
    function _move(address from,address to,uint256 amount) private { balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from,to,amount); }
}
contract Task084NativeRecipient is Task084Probe { receive() external payable { _probe(); } }
contract Task084NftRecipient is Task084Probe {
    function onERC721Received(address,address,uint256,bytes calldata) external returns (bytes4) { _probe(); return 0x150b7a02; }
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external returns (bytes4) { _probe(); return 0xf23a6e61; }
}
contract Task084SafeCallback {
    address private safe;
    bytes private transaction;
    uint256 public attempts;
    uint256 public successes;
    bytes public reason;
    function configure(address account,bytes calldata data) external { safe = account; transaction = data; }
    receive() external payable { attempts++; (bool ok,bytes memory returned) = safe.call(transaction); if (ok) successes++; reason = returned; }
}

contract SeaportTask084GuardEvidenceTest is SeaportAcquisitionBase {
    function _tokenVault() private returns (Task084Currency token) {
        token = new Task084Currency();
        pins.paymentToken = address(token); pins.paymentTokenHash = address(token).codehash;
        vm.prank(CREATOR); vault = new Vault(CREATOR,address(cash),CREATOR,keccak256("task084 exact callback currency"),pins);
        token.transfer(CREATOR,20 ether);
        vm.startPrank(CREATOR);
        vault.configureCollection(address(nft),1,address(nft).codehash,true,true,new uint256[](0));
        vault.configureCollection(address(multi),2,address(multi).codehash,true,true,new uint256[](0));
        vault.configureFeeRecipient(FEE,250);
        token.approve(address(vault),10 ether);
        vault.fundToken(10 ether,keccak256("initial isolated funding"));
        vm.stopPrank();
    }
    function testTask084FundingCallbackCannotMutateAnyPublicGuardedRoute() public {
        Task084Currency token = _tokenVault();
        vm.prank(CREATOR); token.approve(address(vault),1 ether);
        token.configureProbe(vault);
        vm.prank(CREATOR); vault.fundToken(1 ether,keccak256("callback funding"));
        token.assertAllBlocked();
        require(vault.accountedHeld(address(token)) == 11 ether && token.balanceOf(address(vault)) == 11 ether && token.allowance(CREATOR,address(vault)) == 0);
        _conserved(address(token));
    }
    function testTask084ApprovalFulfillmentAndRevokeCallbacksKeepAllBaselines() public {
        Task084Currency token = _tokenVault(); token.configureProbe(vault);
        vm.prank(CREATOR); vault.configurePolicy(T.Policy(address(token),1 ether,10 ether,5 ether,1),true);
        T.AdvancedOrder memory a = _order(false,true,1);
        for (uint256 i; i < a.parameters.consideration.length; i++) a.parameters.consideration[i].token = address(token);
        a = _sign(a); _buy(a);
        token.assertAllBlocked();
        require(token.attempts() >= 25 && token.allowance(address(vault),address(seaport)) == 0);
        require(token.balanceOf(seller) == 925e14 && token.balanceOf(FEE) == 25e14 && token.balanceOf(ROYALTY) == 50e14);
        require(nft.ownerOf(1) == address(vault) && vault.nftHeld(address(nft),1) == 1 && vault.accountedHeld(address(token)) == 9.9 ether);
        _conserved(address(token));
    }
    function testTask084TokenWithdrawalCallbacksCannotConsumeAnotherNotice() public {
        Task084Currency token = _tokenVault();
        vm.startPrank(CREATOR);
        uint64 first = vault.scheduleAssetWithdrawal(address(token),1 ether,OTHER,uint48(_now()+3 days));
        uint64 second = vault.scheduleAssetWithdrawal(address(token),2 ether,FEE,uint48(_now()+3 days));
        vm.stopPrank(); token.configureProbe(vault); vm.warp(_now()+2 days);
        vault.executeWithdrawal(first); token.assertAllBlocked();
        require(token.balanceOf(OTHER) == 1 ether && token.balanceOf(FEE) == 0 && vault.reservedAsset(address(token)) == 2 ether);
        vault.executeWithdrawal(second); token.assertAllBlocked(); require(token.balanceOf(FEE) == 2 ether);
        _conserved(address(token));
    }
    function testTask084NativeFeeAndWithdrawalCallbacksCannotCrossTheLock() public {
        Task084NativeRecipient recipient = new Task084NativeRecipient(); recipient.configureProbe(vault);
        vm.prank(CREATOR); vault.configureFeeRecipient(address(recipient),250); _policy(false);
        T.AdvancedOrder memory a = _order(false,false,1);
        a.parameters.consideration[1].recipient = payable(address(recipient)); _buy(_sign(a));
        recipient.assertAllBlocked(); require(address(recipient).balance == 25e14 && nft.ownerOf(1) == address(vault));
        vm.prank(CREATOR); uint64 id = vault.scheduleAssetWithdrawal(address(0),1 ether,address(recipient),uint48(_now()+3 days));
        vm.warp(_now()+2 days); vault.executeWithdrawal(id); recipient.assertAllBlocked();
        require(address(recipient).balance == 1 ether+25e14 && vault.withdrawn(address(0)) == 1 ether);
        _conserved(address(0));
    }
    function testTask084721And1155WithdrawalCallbacksCannotCrossTheLock() public {
        _policy(false); _buy(_order(false,false,1)); vm.warp(_now()+1); _buy(_order(true,false,2));
        Task084NftRecipient recipient = new Task084NftRecipient(); recipient.configureProbe(vault);
        vm.startPrank(CREATOR);
        uint64 first = vault.scheduleNftWithdrawal(address(nft),1,1,address(recipient),uint48(_now()+3 days));
        uint64 second = vault.scheduleNftWithdrawal(address(multi),2,2,address(recipient),uint48(_now()+3 days));
        vm.stopPrank(); vm.warp(_now()+2 days);
        vault.executeWithdrawal(first); vault.executeWithdrawal(second); recipient.assertAllBlocked();
        require(recipient.attempts() == 10 && nft.ownerOf(1) == address(recipient) && multi.balanceOf(address(recipient),2) == 2);
        require(vault.nftHeld(address(nft),1) == 0 && vault.nftHeld(address(multi),2) == 0 && vault.pendingWithdrawals() == 0);
    }
}

contract SeaportTask084SafeCallbackTest is SeaportAcquisitionBase {
    address private constant SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address private constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address private constant HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    IGenuineSafe private safe;
    uint256[3] private keys;
    function setUp() public override {
        super.setUp();
        string memory archive = vm.readFile(string.concat(vm.projectRoot(),"/../test/fixtures/safe-1.4.1/runtime.json"));
        vm.etch(SINGLETON,vm.parseJsonBytes(archive,".contracts.safe_l2.code"));
        vm.etch(FACTORY,vm.parseJsonBytes(archive,".contracts.safe_proxy_factory.code"));
        vm.etch(HANDLER,vm.parseJsonBytes(archive,".contracts.compatibility_fallback_handler.code"));
        require(SINGLETON.codehash == 0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff);
        require(FACTORY.codehash == 0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317);
        require(HANDLER.codehash == 0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9);
        keys = [uint256(0x840001),uint256(0x840002),uint256(0x840003)];
        for (uint256 i; i < 3; i++) for (uint256 j = i+1; j < 3; j++) if (vm.addr(keys[j]) < vm.addr(keys[i])) (keys[i],keys[j]) = (keys[j],keys[i]);
        address[] memory owners = new address[](3); for (uint256 i; i < 3; i++) owners[i] = vm.addr(keys[i]);
        bytes memory init = abi.encodeCall(IGenuineSafe.setup,(owners,2,address(0),bytes(""),HANDLER,address(0),0,payable(address(0))));
        safe = IGenuineSafe(IGenuineSafeFactory(FACTORY).createProxyWithNonce(SINGLETON,init,84));
        require(address(safe).codehash == 0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c && safe.getThreshold() == 2);
    }
    function _signSafe(address to,bytes memory data) private returns (bytes memory signatures) {
        bytes32 digest = safe.getTransactionHash(to,0,data,0,0,0,0,address(0),address(0),safe.nonce());
        for (uint256 i; i < 2; i++) { (uint8 v,bytes32 r,bytes32 s) = vm.sign(keys[i],digest); signatures = abi.encodePacked(signatures,r,s,v); }
    }
    function _exec(bytes memory data) private {
        bytes memory signatures = _signSafe(address(vault),data);
        require(safe.execTransaction(address(vault),0,data,0,0,0,0,address(0),payable(address(0)),signatures));
    }
    function testTask084AuthorizedSafeCallbackCannotBurnPreparedDisableNonce() public {
        vm.prank(CREATOR); vault.proposeController(address(safe),uint48(_now()+3 days)); vm.warp(_now()+2 days);
        _exec(abi.encodeCall(Vault.acceptController,()));
        Task084SafeCallback recipient = new Task084SafeCallback();
        _exec(abi.encodeCall(Vault.configureFeeRecipient,(address(recipient),uint16(250))));
        _exec(abi.encodeCall(Vault.configurePolicy,(T.Policy(address(0),1 ether,10 ether,5 ether,1),true)));
        bytes memory disable = abi.encodeCall(Vault.disablePurchases,());
        uint256 nonce = safe.nonce(); bytes memory signatures = _signSafe(address(vault),disable);
        recipient.configure(address(safe),abi.encodeCall(IGenuineSafe.execTransaction,(address(vault),0,disable,0,0,0,0,address(0),payable(address(0)),signatures)));
        T.AdvancedOrder memory a = _order(false,false,1); a.parameters.consideration[1].recipient = payable(address(recipient));
        a = _sign(a); T.Request memory request = _request(a); vm.prank(OTHER); vault.purchase(a,request);
        require(recipient.attempts() == 1 && recipient.successes() == 0 && safe.nonce() == nonce);
        require(keccak256(recipient.reason()) == keccak256(abi.encodeWithSignature("Error(string)","GS013")));
        require(vault.purchasesEnabled() && vault.nftHeld(address(nft),1) == 1 && address(recipient).balance == 25e14);
        require(safe.execTransaction(address(vault),0,disable,0,0,0,0,address(0),payable(address(0)),signatures));
        require(safe.nonce() == nonce+1 && !vault.purchasesEnabled()); _conserved(address(0));
    }
}
