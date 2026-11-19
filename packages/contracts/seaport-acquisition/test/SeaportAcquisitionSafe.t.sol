// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SeaportAcquisitionBase} from "./SeaportAcquisition.t.sol";
import {SeaportAcquisitionTypes as T} from "../src/SeaportAcquisitionTypes.sol";

interface IGenuineSafeFactory { function createProxyWithNonce(address,bytes calldata,uint256) external returns(address); }
interface IGenuineSafe {
    function setup(address[] calldata,uint256,address,bytes calldata,address,address,uint256,address payable) external;
    function nonce() external view returns(uint256);
    function getThreshold() external view returns(uint256);
    function getMessageHash(bytes calldata) external view returns(bytes32);
    function getTransactionHash(address,uint256,bytes calldata,uint8,uint256,uint256,uint256,address,address,uint256) external view returns(bytes32);
    function execTransaction(address,uint256,bytes calldata,uint8,uint256,uint256,uint256,address,address payable,bytes calldata) external payable returns(bool);
}
/// @notice Actual archived SafeL2 1.4.1, proxy factory and compatibility handler;
/// these tests do not replace runtime/account checks with an authority mock.
contract SeaportAcquisitionSafeTest is SeaportAcquisitionBase {
    address private constant SINGLETON=0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address private constant FACTORY=0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address private constant HANDLER=0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    IGenuineSafe private safe;
    uint256[3] private keys;
    function setUp() public override {
        super.setUp();
        string memory archive=vm.readFile(string.concat(vm.projectRoot(),"/../test/fixtures/safe-1.4.1/runtime.json"));
        vm.etch(SINGLETON,vm.parseJsonBytes(archive,".contracts.safe_l2.code"));
        vm.etch(FACTORY,vm.parseJsonBytes(archive,".contracts.safe_proxy_factory.code"));
        vm.etch(HANDLER,vm.parseJsonBytes(archive,".contracts.compatibility_fallback_handler.code"));
        require(SINGLETON.codehash==0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff);
        require(FACTORY.codehash==0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317);
        require(HANDLER.codehash==0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9);
        keys=[uint256(0x830001),uint256(0x830002),uint256(0x830003)];
        for(uint256 i;i<3;i++)for(uint256 j=i+1;j<3;j++)if(vm.addr(keys[j])<vm.addr(keys[i]))(keys[i],keys[j])=(keys[j],keys[i]);
        address[] memory owners=new address[](3); for(uint256 i;i<3;i++)owners[i]=vm.addr(keys[i]);
        bytes memory initializer=abi.encodeCall(IGenuineSafe.setup,(owners,2,address(0),bytes(""),HANDLER,address(0),0,payable(address(0))));
        safe=IGenuineSafe(IGenuineSafeFactory(FACTORY).createProxyWithNonce(SINGLETON,initializer,83));
        require(address(safe).codehash==0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c&&safe.getThreshold()==2);
        vm.deal(address(safe),10 ether);
    }
    function _sigs(bytes32 digest,uint256 number) private returns(bytes memory signatures) {
        for(uint256 i;i<number;i++) { (uint8 v,bytes32 r,bytes32 s)=vm.sign(keys[i],digest); signatures=abi.encodePacked(signatures,r,s,v); }
    }
    function _txSigs(address to,uint256 value,bytes memory data,uint256 number) private returns(bytes memory) {
        return _sigs(safe.getTransactionHash(to,value,data,0,0,0,0,address(0),address(0),safe.nonce()),number);
    }
    function _exec(address to,uint256 value,bytes memory data) private returns(bool) {
        bytes memory signatures=_txSigs(to,value,data,2);
        return safe.execTransaction(to,value,data,0,0,0,0,address(0),payable(address(0)),signatures);
    }
    function _rotate() private {
        vm.prank(CREATOR); vault.proposeController(address(safe),uint48(_now()+3 days)); vm.warp(_now()+2 days);
        require(_exec(address(vault),0,abi.encodeWithSignature("acceptController()")));
    }
    function testGenuineSafeTwoOfThreeFundingAndStandingPolicyWithDistinctGasPayer() public {
        _rotate(); uint256 safeBefore=address(safe).balance;
        require(_exec(address(vault),1 ether,abi.encodeWithSignature("fundNative(bytes32)",keccak256("Safe-funded native"))));
        require(address(safe).balance==safeBefore-1 ether&&vault.funded(address(0))==11 ether);
        require(_exec(address(vault),0,abi.encodeWithSignature("configurePolicy((address,uint128,uint128,uint128,uint32),bool)",T.Policy(address(0),1 ether,10 ether,5 ether,1),true)));
        T.AdvancedOrder memory a=_order(false,false,1); T.Request memory r=_request(a); vm.prank(OTHER); vault.purchase(a,r);
        require(vault.controller()==address(safe)&&vault.nftHeld(address(nft),1)==1&&address(safe).balance==safeBefore-1 ether);
        require(_exec(address(vault),0,abi.encodeWithSignature("disablePurchases()"))); require(!vault.purchasesEnabled());
    }
    function testGenuineSafeOneOwnerAndReplayCannotControlVault() public {
        _rotate(); bytes memory data=abi.encodeWithSignature("fundNative(bytes32)",keccak256("Safe replay"));
        bytes memory one=_txSigs(address(vault),1 ether,data,1); uint256 nonce=safe.nonce();
        vm.expectRevert(); safe.execTransaction(address(vault),1 ether,data,0,0,0,0,address(0),payable(address(0)),one); require(safe.nonce()==nonce);
        bytes memory both=_txSigs(address(vault),1 ether,data,2);
        require(safe.execTransaction(address(vault),1 ether,data,0,0,0,0,address(0),payable(address(0)),both));
        vm.expectRevert(); safe.execTransaction(address(vault),1 ether,data,0,0,0,0,address(0),payable(address(0)),both);
        require(vault.funded(address(0))==11 ether);
    }
    function _safeOrder() private returns(T.AdvancedOrder memory a) {
        nft.mint(address(safe),83); require(_exec(address(nft),0,abi.encodeWithSignature("approve(address,uint256)",address(seaport),83)));
        a=_order(false,false,83); a.parameters.offerer=address(safe); a.parameters.consideration[0].recipient=payable(address(safe));
        bytes32 orderDigest=keccak256(abi.encodePacked(hex"1901",vault.domainSeparator(),_hash(a,0)));
        // CompatibilityFallbackHandler authenticates SafeMessage under this
        // Safe's domain, not an EOA signature over the raw marketplace digest.
        a.signature=_sigs(safe.getMessageHash(abi.encode(orderDigest)),2);
    }
    function testGenuineSafe1271SellerWithTwoOwnerSafeMessageSignatures() public {
        _policy(false); T.AdvancedOrder memory a=_safeOrder(); uint256 before_=address(safe).balance; _buy(a);
        require(nft.ownerOf(83)==address(vault)&&address(safe).balance==before_+925e14&&vault.nftHeld(address(nft),83)==1);
    }
    function testGenuineSafe1271WrongOwnerCountRejectsAndPreservesAllAssets() public {
        _policy(false); T.AdvancedOrder memory a=_safeOrder(); bytes32 digest=keccak256(abi.encodePacked(hex"1901",vault.domainSeparator(),_hash(a,0)));
        a.signature=_sigs(safe.getMessageHash(abi.encode(digest)),1); _reject(a);
        require(nft.ownerOf(83)==address(safe)&&vault.totalSpent(address(0))==0&&FEE.balance==0);
    }
}
