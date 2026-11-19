// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTReclaimCampaignV1} from "./RMTReclaimCampaignV1.sol";
import {IReclaimERC20} from "./ReclaimInterfaces.sol";

/// @notice Owner-scoped immutable campaign deployments, never token issuance.
contract RMTReclaimFactoryV1 {
    address public immutable rewardToken;
    bytes32 public immutable rewardRuntimeHash;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable campaignCreationCodeHash;
    mapping(address=>mapping(bytes32=>address)) public campaignForIntent;
    error InvalidConfiguration();
    event CampaignCreated(address indexed creator,address indexed campaign,bytes32 indexed intent,address controller,uint128 rewardPerUnit,uint32 walletCap);
    constructor(address token,bytes32 hash){
        if((block.chainid!=31337&&block.chainid!=4663)||token==address(0)||hash==bytes32(0)||token.code.length==0||token.codehash!=hash
            ||IReclaimERC20(token).decimals()!=18||IReclaimERC20(token).totalSupply()!=1_000_000_000 ether)revert InvalidConfiguration();
        rewardToken=token;rewardRuntimeHash=hash;deploymentChainId=block.chainid;campaignCreationCodeHash=keccak256(type(RMTReclaimCampaignV1).creationCode);
    }
    function saltFor(address creator,bytes32 intent) public view returns(bytes32){return keccak256(abi.encode(deploymentChainId,creator,intent));}
    function predict(address creator,bytes32 intent,address controller,uint128 rate,uint32 cap) external view returns(address){
        bytes32 initHash=keccak256(bytes.concat(type(RMTReclaimCampaignV1).creationCode,abi.encode(creator,controller,rewardToken,rewardRuntimeHash,rate,cap)));
        return address(uint160(uint256(keccak256(bytes.concat(hex"ff",bytes20(address(this)),saltFor(creator,intent),initHash)))));
    }
    function create(bytes32 intent,address controller,uint128 rate,uint32 cap) external returns(address campaign){
        if(block.chainid!=deploymentChainId||rewardToken.codehash!=rewardRuntimeHash||intent==bytes32(0)||campaignForIntent[msg.sender][intent]!=address(0))revert InvalidConfiguration();
        campaign=address(new RMTReclaimCampaignV1{salt:saltFor(msg.sender,intent)}(msg.sender,controller,rewardToken,rewardRuntimeHash,rate,cap));
        campaignForIntent[msg.sender][intent]=campaign;emit CampaignCreated(msg.sender,campaign,intent,controller,rate,cap);
    }
}
