// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SeaportAcquisitionTypes as T, IAcquisitionSeaport, IAcquisitionToken, IAcquisitionSignature, IAcquisition165, IAcquisition2981, IAcquisitionCore, IAcquisitionCurve} from "./SeaportAcquisitionTypes.sol";
import {NftAcquisitionAccounts} from "../../nft-acquisition/src/NftAcquisitionAccounts.sol";

interface ISeaportVaultIdentity {
    function coreFactory() external view returns (address); function coreFactoryHash() external view returns (bytes32);
    function projectToken() external view returns (address); function tokenRuntimeHash() external view returns (bytes32);
    function seaport() external view returns (address); function seaportHash() external view returns (bytes32);
    function conduitController() external view returns (address); function conduitControllerHash() external view returns (bytes32);
    function paymentToken() external view returns (address); function paymentTokenHash() external view returns (bytes32);
    function originCurve() external view returns (address); function creator() external view returns (address);
}

/// @dev Constructor-created stateless view helper. No assets, approvals, mutable
/// settings, fulfillment, delegatecall or execution capability exists here.
contract SeaportAcquisitionChecksV2 {
    error InvalidOrder();
    error InvalidBinding();
    function binding(address who) external view {
        ISeaportVaultIdentity v = ISeaportVaultIdentity(who);
        address core = v.coreFactory(); address token = v.projectToken(); address curve = v.originCurve();
        if (block.chainid != 31337 || core.codehash != v.coreFactoryHash() || token.codehash != v.tokenRuntimeHash()
            || v.seaport().codehash != v.seaportHash() || v.conduitController().codehash != v.conduitControllerHash()
            || v.paymentToken().codehash != v.paymentTokenHash() || IAcquisitionCore(core).originCurveForToken(token) != curve
            || IAcquisitionCurve(curve).creator() != v.creator() || IAcquisitionCurve(curve).token() != token || IAcquisitionCurve(curve).factory() != core) revert InvalidBinding();
    }
    function collection(address asset,uint8 standard,bytes32 hash) external view {
        if (asset.code.length == 0 || asset.codehash != hash || hash == bytes32(0) || (standard != 1 && standard != 2)
            || !IAcquisition165(asset).supportsInterface(0x01ffc9a7) || IAcquisition165(asset).supportsInterface(0xffffffff)
            || !IAcquisition165(asset).supportsInterface(standard == 1 ? bytes4(0x80ac58cd) : bytes4(0xd9b67a26))) revert InvalidOrder();
    }
    function supported(address who) external view returns (bool) { return NftAcquisitionAccounts.supported(who); }
    function signature(address seller,bytes32 domain,bytes32 hash,bytes calldata sig) public view {
        if (!NftAcquisitionAccounts.supported(seller)) revert InvalidOrder();
        bytes32 digest = keccak256(abi.encodePacked(hex"1901",domain,hash));
        if (seller.code.length != 0) {
            if (sig.length == 0 || sig.length > 4096 || IAcquisitionSignature(seller).isValidSignature(digest,sig) != 0x1626ba7e) revert InvalidOrder();
        } else {
            bytes32 r; bytes32 s; uint8 v;
            if (sig.length == 65) { assembly ("memory-safe") { r := calldataload(sig.offset) s := calldataload(add(sig.offset,32)) v := byte(0,calldataload(add(sig.offset,64))) } }
            else if (sig.length == 64) { bytes32 vs; assembly ("memory-safe") { r := calldataload(sig.offset) vs := calldataload(add(sig.offset,32)) } s = bytes32(uint256(vs) & 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff); v = uint8((uint256(vs) >> 255) + 27); }
            else revert InvalidOrder();
            if ((v != 27 && v != 28) || uint256(s) == 0 || uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 || ecrecover(digest,v,r,s) != seller) revert InvalidOrder();
        }
    }
    function orderHash(address seaport,T.AdvancedOrder calldata a,uint256 counter) public view returns (bytes32) {
        T.OrderParameters calldata p = a.parameters;
        return IAcquisitionSeaport(seaport).getOrderHash(T.OrderComponents(p.offerer,p.zone,p.offer,p.consideration,p.orderType,p.startTime,p.endTime,p.zoneHash,p.salt,p.conduitKey,counter));
    }
    function admit(T.AdvancedOrder calldata a,T.Request calldata r,address currency,address vault,address seaport,bytes32 domain,uint16[] calldata bps) external view returns (uint256,uint256[] memory) {
        if (orderHash(seaport,a,r.counter) != r.signedOrderHash || IAcquisitionSeaport(seaport).getCounter(a.parameters.offerer) != r.counter) revert InvalidOrder();
        (,bool cancelled,uint256 filled,uint256 size) = IAcquisitionSeaport(seaport).getOrderStatus(r.signedOrderHash);
        if (cancelled || filled != 0 || size != 0) revert InvalidOrder();
        signature(a.parameters.offerer,domain,r.signedOrderHash,a.signature);
        return consideration(a.parameters,currency,vault,seaport,bps);
    }
    function completed(address seaport,address seller,bytes32 hash,uint256 counter,bytes32 domain,bytes calldata sig) external view {
        (bool validated,bool cancelled,uint256 filled,uint256 size) = IAcquisitionSeaport(seaport).getOrderStatus(hash);
        if (!validated || cancelled || filled != 1 || size != 1 || IAcquisitionSeaport(seaport).getCounter(seller) != counter) revert InvalidOrder();
        signature(seller,domain,hash,sig);
    }
    function royalty(address asset,uint256 id,uint256 total) external view returns (bytes32) {
        return _royalty(asset,id,total);
    }
    function _royalty(address asset,uint256 id,uint256 total) private view returns (bytes32) {
        if (!IAcquisition165(asset).supportsInterface(0x2a55205a)) return bytes32(0);
        (address recipient,uint256 amount) = IAcquisition2981(asset).royaltyInfo(id,total);
        return keccak256(abi.encode(recipient,amount));
    }
    function consideration(T.OrderParameters calldata o,address currency,address vault,address seaport,uint16[] calldata feeBps) public view returns (uint256 total,uint256[] memory balances) {
        uint256 length = o.consideration.length;
        if (length == 0 || length > 10 || feeBps.length != length || o.totalOriginalConsiderationItems != length) revert InvalidOrder();
        balances = new uint256[](length);
        for (uint256 i; i < length; i++) {
            T.ConsiderationItem calldata c = o.consideration[i];
            if (c.itemType != (currency == address(0) ? 0 : 1) || c.token != currency || c.identifierOrCriteria != 0 || c.startAmount == 0 || c.startAmount != c.endAmount
                || c.recipient == address(0) || c.recipient == vault || c.recipient == seaport) revert InvalidOrder();
            for (uint256 j; j < i; j++) if (o.consideration[j].recipient == c.recipient) revert InvalidOrder();
            total += c.startAmount; balances[i] = currency == address(0) ? c.recipient.balance : IAcquisitionToken(currency).balanceOf(c.recipient);
        }
        if (o.offer.length != 1 || o.consideration[0].recipient != o.offerer) revert InvalidOrder();
        address royaltyRecipient; uint256 royaltyAmount;
        if (IAcquisition165(o.offer[0].token).supportsInterface(0x2a55205a)) (royaltyRecipient,royaltyAmount) = IAcquisition2981(o.offer[0].token).royaltyInfo(o.offer[0].identifierOrCriteria,total);
        bool royaltySeen;
        for (uint256 i = 1; i < length; i++) {
            T.ConsiderationItem calldata c = o.consideration[i];
            if (royaltyAmount != 0 && c.recipient == royaltyRecipient) { if (royaltySeen || c.startAmount != royaltyAmount) revert InvalidOrder(); royaltySeen = true; }
            else if (feeBps[i] == 0 || c.startAmount > total * feeBps[i] / 10000) revert InvalidOrder();
        }
        if (royaltyAmount != 0 && (!royaltySeen || royaltyRecipient == o.offerer)) revert InvalidOrder();
    }
}
