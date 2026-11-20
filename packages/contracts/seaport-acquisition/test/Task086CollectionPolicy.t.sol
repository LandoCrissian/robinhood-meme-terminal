// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SeaportAcquisitionBase} from "./SeaportAcquisition.t.sol";
import {RMTSeaportAcquisitionVaultV2 as Vault} from "../src/RMTSeaportAcquisitionVaultV2.sol";
import {SeaportAcquisitionTypes as T} from "../src/SeaportAcquisitionTypes.sol";

interface ITask086Receiver {
    function onERC721Received(address,address,uint256,bytes calldata) external returns (bytes4);
}

/// @dev Deliberately mutable synthetic issuer policy. It is not the real
/// candidate collection's validator, nor a production collection admission.
contract Task086MutableValidator {
    address public owner;
    address public collection;
    address public blockedSender;
    address public blockedReceiver;
    error ReceiverPolicyVeto();
    constructor() { owner = msg.sender; }
    function bindCollection(address next) external {
        require(msg.sender == owner && collection == address(0)); collection = next;
    }
    function setPolicy(address from,address to) external {
        require(msg.sender == owner); blockedSender = from; blockedReceiver = to;
    }
    function transferOwnership(address next) external {
        require(msg.sender == owner && next != address(0)); owner = next;
    }
    function validateTransfer(address from,address to) external view {
        require(msg.sender == collection);
        if ((blockedSender != address(0) && from == blockedSender)
            || (blockedReceiver != address(0) && to == blockedReceiver)) revert ReceiverPolicyVeto();
    }
}

/// @dev Honest balances and standard ERC721 transfers with a mutable external
/// policy. Mint/policy authority is explicit synthetic test control only.
contract Task086Policy721 {
    address public immutable issuer;
    address public immutable royaltyRecipient;
    Task086MutableValidator public immutable transferValidator;
    mapping(uint256 => address) private owners;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    error SellerApprovalMissing();
    event Transfer(address indexed from,address indexed to,uint256 indexed id);
    event ApprovalForAll(address indexed owner,address indexed operator,bool approved);
    constructor(Task086MutableValidator validator,address royalty) {
        issuer = msg.sender; transferValidator = validator; royaltyRecipient = royalty;
    }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x2a55205a;
    }
    function ownerOf(uint256 id) public view returns (address) {
        require(owners[id] != address(0)); return owners[id];
    }
    function royaltyInfo(uint256,uint256 total) external view returns (address,uint256) {
        return (royaltyRecipient,total * 500 / 10000);
    }
    function mint(address to,uint256 id) external {
        require(msg.sender == issuer && to != address(0) && owners[id] == address(0));
        owners[id] = to; balanceOf[to]++; emit Transfer(address(0),to,id);
    }
    function setApprovalForAll(address operator,bool approved) external {
        require(operator != msg.sender); isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender,operator,approved);
    }
    function transferFrom(address from,address to,uint256 id) public {
        require(ownerOf(id) == from && to != address(0));
        if (msg.sender != from && getApproved[id] != msg.sender && !isApprovedForAll[from][msg.sender]) revert SellerApprovalMissing();
        transferValidator.validateTransfer(from,to);
        delete getApproved[id]; owners[id] = to; balanceOf[from]--; balanceOf[to]++;
        emit Transfer(from,to,id);
    }
    function safeTransferFrom(address from,address to,uint256 id) external {
        transferFrom(from,to,id);
        if (to.code.length != 0) require(ITask086Receiver(to).onERC721Received(msg.sender,from,id,"") == 0x150b7a02);
    }
}

/// @dev A synthetic issuer-controlled recipient demonstrates that mutable
/// external policy can change inside a legitimate fulfillment callback.
contract Task086PolicyChangingFeeRecipient {
    Task086MutableValidator private immutable validator;
    address private immutable vault;
    constructor(Task086MutableValidator target,address heldBy) { validator = target; vault = heldBy; }
    receive() external payable { validator.setPolicy(vault,address(0)); }
}

contract Task086CollectionPolicyTest is SeaportAcquisitionBase {
    Task086MutableValidator private validator;
    Task086Policy721 private asset;
    function setUp() public override {
        super.setUp(); validator = new Task086MutableValidator();
        asset = new Task086Policy721(validator,ROYALTY); validator.bindCollection(address(asset));
        asset.mint(seller,1); asset.mint(seller,2);
        vm.prank(CREATOR); vault.configureCollection(address(asset),1,address(asset).codehash,true,true,new uint256[](0));
    }
    function _assetOrder(uint256 id) private returns (T.AdvancedOrder memory a) {
        a = _order(false,false,id); a.parameters.offer[0].token = address(asset); return _sign(a);
    }
    function _approve() private { vm.prank(seller); asset.setApprovalForAll(address(seaport),true); }
    function _unchangedAfterFailure(T.AdvancedOrder memory a) private view {
        require(asset.ownerOf(1) == seller && asset.balanceOf(seller) == 2 && asset.balanceOf(address(vault)) == 0);
        require(vault.nftHeld(address(asset),1) == 0 && !vault.orderConsumed(_hash(a,0)));
        require(vault.accountedHeld(address(0)) == 10 ether && vault.totalSpent(address(0)) == 0 && vault.lastPurchaseAt() == 0);
        require(seller.balance == 0 && FEE.balance == 0 && ROYALTY.balance == 0);
        _conserved(address(0));
    }
    function testTask086MissingSellerApprovalAndValidatorVetoAreDistinctAtomicFailures() public {
        _policy(false); T.AdvancedOrder memory a = _assetOrder(1);
        vm.expectRevert(Task086Policy721.SellerApprovalMissing.selector); vm.prank(address(seaport));
        asset.transferFrom(seller,address(vault),1);
        _reject(a); _unchangedAfterFailure(a);

        _approve(); validator.setPolicy(address(0),address(vault));
        vm.expectRevert(Task086MutableValidator.ReceiverPolicyVeto.selector); vm.prank(address(seaport));
        asset.transferFrom(seller,address(vault),1);
        _reject(a); _unchangedAfterFailure(a);

        validator.setPolicy(address(0),address(0)); _buy(a);
        require(asset.ownerOf(1) == address(vault) && vault.nftHeld(address(asset),1) == 1);
        require(vault.orderConsumed(_hash(a,0)) && vault.totalSpent(address(0)) == .1 ether);
        require(seller.balance == 925e14 && FEE.balance == 25e14 && ROYALTY.balance == 50e14);
        _conserved(address(0));
    }
    function testTask086IssuerFreezeAfterPurchasePreservesFailedWithdrawalAndReservation() public {
        _approve(); _policy(false); _buy(_assetOrder(1));
        vm.prank(CREATOR); uint64 notice = vault.scheduleNftWithdrawal(address(asset),1,1,OTHER,uint48(_now()+3 days));
        bytes32 nftHash = address(asset).codehash; bytes32 validatorHash = address(validator).codehash;
        validator.setPolicy(address(vault),address(0)); vm.warp(_now()+2 days);
        vm.expectRevert(Task086MutableValidator.ReceiverPolicyVeto.selector); vault.executeWithdrawal(notice);
        (,,,,,,,,uint8 state) = vault.withdrawals(notice);
        require(state == 1 && vault.pendingWithdrawals() == 1 && vault.nftReserved(address(asset),1) == 1);
        require(vault.nftHeld(address(asset),1) == 1 && asset.ownerOf(1) == address(vault));
        require(address(asset).codehash == nftHash && address(validator).codehash == validatorHash);
        require(vault.accountedHeld(address(0)) == 9.9 ether && vault.totalSpent(address(0)) == .1 ether);
        vm.prank(CREATOR); vault.cancelWithdrawal(notice);
        require(vault.nftReserved(address(asset),1) == 0 && vault.nftHeld(address(asset),1) == 1 && asset.ownerOf(1) == address(vault));
        _conserved(address(0));
    }
    function testTask086PolicyCanChangeDuringPaymentWithoutChangingCodeOrFinancialDeltas() public {
        Task086PolicyChangingFeeRecipient recipient = new Task086PolicyChangingFeeRecipient(validator,address(vault));
        vm.prank(CREATOR); vault.configureFeeRecipient(address(recipient),250);
        validator.transferOwnership(address(recipient)); _approve(); _policy(false);
        bytes32 nftHash = address(asset).codehash; bytes32 validatorHash = address(validator).codehash;
        T.AdvancedOrder memory a = _assetOrder(1); a.parameters.consideration[1].recipient = payable(address(recipient));
        _buy(_sign(a));
        require(validator.blockedSender() == address(vault) && address(asset).codehash == nftHash && address(validator).codehash == validatorHash);
        require(asset.ownerOf(1) == address(vault) && vault.nftHeld(address(asset),1) == 1);
        require(vault.accountedHeld(address(0)) == 9.9 ether && vault.totalSpent(address(0)) == .1 ether);
        require(seller.balance == 925e14 && address(recipient).balance == 25e14 && ROYALTY.balance == 50e14);
        vm.prank(CREATOR); uint64 notice = vault.scheduleNftWithdrawal(address(asset),1,1,OTHER,uint48(_now()+3 days));
        vm.warp(_now()+2 days); vm.expectRevert(Task086MutableValidator.ReceiverPolicyVeto.selector); vault.executeWithdrawal(notice);
        require(vault.nftHeld(address(asset),1) == 1 && vault.nftReserved(address(asset),1) == 1 && asset.ownerOf(1) == address(vault));
        _conserved(address(0));
    }
}
