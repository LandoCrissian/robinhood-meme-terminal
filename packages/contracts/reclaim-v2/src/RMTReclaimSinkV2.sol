// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Deliberately non-executing NFT receiver. It has no administrator,
/// approval, withdrawal, arbitrary-call, upgrade, delegatecall or destruction
/// path. A sink transfer is NOT a native burn. Its permanence additionally
/// requires an independently reviewed non-upgradeable/non-seizable collection.
contract RMTReclaimSinkV2 {
    function onERC721Received(address,address,uint256,bytes calldata) external pure returns(bytes4){return 0x150b7a02;}
    function onERC1155Received(address,address,uint256,uint256,bytes calldata) external pure returns(bytes4){return 0xf23a6e61;}
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure returns(bytes4){return 0xbc197c81;}
    function supportsInterface(bytes4 id) external pure returns(bool){return id==0x01ffc9a7||id==0x150b7a02||id==0x4e2312e0;}
}
