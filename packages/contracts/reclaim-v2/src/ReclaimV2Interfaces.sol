// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IReclaimV2ERC20 {
    function balanceOf(address) external view returns(uint256);
    function totalSupply() external view returns(uint256);
    function decimals() external view returns(uint8);
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
}
interface IReclaimV2ERC165 {function supportsInterface(bytes4) external view returns(bool);}
interface IReclaimV2ERC721 {
    function ownerOf(uint256) external view returns(address);
    function exists(uint256) external view returns(bool);
    function balanceOf(address) external view returns(uint256);
    function totalSupply() external view returns(uint256);
    function burn(uint256) external;
    function safeTransferFrom(address,address,uint256,bytes calldata) external;
}
interface IReclaimV2ERC1155 {
    function balanceOf(address,uint256) external view returns(uint256);
    function totalSupply(uint256) external view returns(uint256);
    function burn(address,uint256,uint256) external;
    function safeBatchTransferFrom(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external;
}
interface IReclaimV2Factory {
    function retirementPolicy(bytes32,uint8,uint8) external view returns(bytes32);
    function campaignDeployer() external view returns(address);
    function permanentSink() external view returns(address);
    function sinkRuntimeHash() external view returns(bytes32);
}
library ReclaimV2Eligibility {
    function leaf(uint256 chain,address campaign,address collection,bytes32 runtimeHash,uint8 standard,uint8 mode,bytes32 policyHash,uint256 id,uint256 maximum) internal pure returns(bytes32){
        return keccak256(abi.encode(chain,campaign,collection,runtimeHash,standard,mode,policyHash,id,maximum));
    }
    function verify(bytes32 root,bytes32 value,bytes32[] calldata proof) internal pure returns(bool){
        if(proof.length>32)return false;
        for(uint256 i;i<proof.length;i++)value=value<proof[i]?keccak256(abi.encode(value,proof[i])):keccak256(abi.encode(proof[i],value));
        return value==root;
    }
}
