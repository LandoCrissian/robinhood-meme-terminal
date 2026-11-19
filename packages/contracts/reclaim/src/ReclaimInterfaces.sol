// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IReclaimERC20 {
    function balanceOf(address account) external view returns(uint256);
    function totalSupply() external view returns(uint256);
    function decimals() external view returns(uint8);
    function transfer(address to,uint256 amount) external returns(bool);
    function transferFrom(address from,address to,uint256 amount) external returns(bool);
}
interface IReclaimERC165 { function supportsInterface(bytes4 id) external view returns(bool); }
interface IReclaimERC721 {
    function ownerOf(uint256 id) external view returns(address);
    function safeTransferFrom(address from,address to,uint256 id,bytes calldata data) external;
}
interface IReclaimERC1155 {
    function balanceOf(address account,uint256 id) external view returns(uint256);
    function safeBatchTransferFrom(address from,address to,uint256[] calldata ids,uint256[] calldata amounts,bytes calldata data) external;
}

/// @dev Sorted-pair Merkle verification with explicit bounded proof length.
/// A leaf binds chain, campaign, runtime, standard, ID and maximum lifetime units.
library ReclaimEligibility {
    function leaf(uint256 chain,address campaign,address collection,bytes32 runtimeHash,uint8 standard,uint256 id,uint256 maximum) internal pure returns(bytes32) {
        return keccak256(abi.encode(chain,campaign,collection,runtimeHash,standard,id,maximum));
    }
    function verify(bytes32 root,bytes32 value,bytes32[] calldata proof) internal pure returns(bool) {
        if(proof.length>32)return false;
        for(uint256 i;i<proof.length;i++)value=value<proof[i]?keccak256(abi.encode(value,proof[i])):keccak256(abi.encode(proof[i],value));
        return value==root;
    }
}
