// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable typed code container. Only its creating factory can deploy
/// the exact campaign implementation; no generic call or upgrade exists.
contract RMTReclaimCampaignDeployerV2 {
    address public immutable factory;
    address public immutable rewardToken;
    bytes32 public immutable rewardRuntimeHash;
    address public immutable permanentSink;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable campaignCreationCodeHash;
    address public immutable creationPart1;
    address public immutable creationPart2;
    bytes32 public immutable creationPart1Hash;
    bytes32 public immutable creationPart2Hash;
    error Unauthorized();
    constructor(address token,bytes32 hash,address sink,address part1,address part2,bytes32 codeHash){
        factory=msg.sender;rewardToken=token;rewardRuntimeHash=hash;permanentSink=sink;deploymentChainId=block.chainid;
        if(part1.code.length<2||part2.code.length<2||codeHash==bytes32(0))revert Unauthorized();
        creationPart1=part1;creationPart2=part2;creationPart1Hash=part1.codehash;creationPart2Hash=part2.codehash;campaignCreationCodeHash=codeHash;
        _creationCode();
    }
    function _creationCode() private view returns(bytes memory code){
        address a=creationPart1;address b=creationPart2;
        if(a.codehash!=creationPart1Hash||b.codehash!=creationPart2Hash)revert Unauthorized();
        uint256 n=a.code.length-1;uint256 m=b.code.length-1;
        code=new bytes(n+m);
        assembly ("memory-safe") {extcodecopy(a,add(code,32),1,n) extcodecopy(b,add(add(code,32),n),1,m)}
        if(keccak256(code)!=campaignCreationCodeHash)revert Unauthorized();
    }
    function _initcode(address creator,address controller,uint128 rate,uint32 cap) private view returns(bytes memory){return bytes.concat(_creationCode(),abi.encode(creator,controller,rewardToken,rewardRuntimeHash,rate,cap,factory,permanentSink));}
    function saltFor(address creator,bytes32 intent) public view returns(bytes32){return keccak256(abi.encode(deploymentChainId,creator,intent));}
    function predict(address creator,bytes32 intent,address controller,uint128 rate,uint32 cap) external view returns(address){
        bytes32 hash=keccak256(_initcode(creator,controller,rate,cap));
        return address(uint160(uint256(keccak256(bytes.concat(hex"ff",bytes20(address(this)),saltFor(creator,intent),hash)))));
    }
    function deploy(address creator,bytes32 intent,address controller,uint128 rate,uint32 cap) external returns(address campaign){
        if(msg.sender!=factory||block.chainid!=deploymentChainId||rewardToken.codehash!=rewardRuntimeHash)revert Unauthorized();
        bytes memory code=_initcode(creator,controller,rate,cap);bytes32 salt=saltFor(creator,intent);
        assembly ("memory-safe") {campaign:=create2(0,add(code,32),mload(code),salt)}
        if(campaign==address(0))revert Unauthorized();
    }
}
