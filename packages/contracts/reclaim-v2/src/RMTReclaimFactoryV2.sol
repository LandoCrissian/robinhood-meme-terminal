// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTReclaimCampaignDeployerV2} from "./RMTReclaimCampaignDeployerV2.sol";
import {RMTReclaimSinkV2} from "./RMTReclaimSinkV2.sol";
import {RMTReclaimCampaignV2} from "./RMTReclaimCampaignV2.sol";
import {RMTReclaimCodePartV2} from "./RMTReclaimCodePartV2.sol";
import {IReclaimV2ERC20} from "./ReclaimV2Interfaces.sol";

/// @notice Versioned permanent-surrender campaigns, not ERC20 issuance.
/// @dev Runtime/standard/mode/policy commitments are installed once in the
/// constructor. New collection implementations require an independently reviewed
/// new factory version; controllers cannot silently admit arbitrary runtimes.
contract RMTReclaimFactoryV2 {
    struct RetirementProfile {bytes32 runtimeHash;uint8 standard;uint8 mode;bytes32 policyHash;}
    address public immutable rewardToken;
    bytes32 public immutable rewardRuntimeHash;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable campaignCreationCodeHash;
    address public immutable campaignDeployer;
    address public immutable permanentSink;
    bytes32 public immutable sinkRuntimeHash;
    bytes32 public immutable retirementProfilesHash;
    address public immutable creationPart1;
    address public immutable creationPart2;
    mapping(bytes32=>bytes32) private retirementPolicies;
    mapping(address=>mapping(bytes32=>address)) public campaignForIntent;
    error InvalidConfiguration();
    event RetirementProfileCommitted(bytes32 indexed runtimeHash,uint8 standard,uint8 mode,bytes32 policyHash);
    event CampaignCreated(address indexed creator,address indexed campaign,bytes32 indexed intent,address controller,uint128 rewardPerUnit,uint32 walletCap);
    constructor(address token,bytes32 hash,RetirementProfile[] memory profiles){
        if((block.chainid!=31337&&block.chainid!=4663)||token==address(0)||hash==bytes32(0)||token.code.length==0||token.codehash!=hash
            ||IReclaimV2ERC20(token).decimals()!=18||IReclaimV2ERC20(token).totalSupply()!=1_000_000_000 ether||profiles.length==0||profiles.length>16)revert InvalidConfiguration();
        rewardToken=token;rewardRuntimeHash=hash;deploymentChainId=block.chainid;retirementProfilesHash=keccak256(abi.encode(profiles));
        for(uint256 i;i<profiles.length;i++){
            RetirementProfile memory p=profiles[i];bytes32 key=keccak256(abi.encode(p.runtimeHash,p.standard,p.mode));
            if(p.runtimeHash==bytes32(0)||p.policyHash==bytes32(0)||(p.standard!=1&&p.standard!=2)||(p.mode!=1&&p.mode!=2)||retirementPolicies[key]!=bytes32(0))revert InvalidConfiguration();
            retirementPolicies[key]=p.policyHash;emit RetirementProfileCommitted(p.runtimeHash,p.standard,p.mode,p.policyHash);
        }
        address sink=address(new RMTReclaimSinkV2());permanentSink=sink;sinkRuntimeHash=sink.codehash;
        bytes memory fullCode=type(RMTReclaimCampaignV2).creationCode;uint256 half=fullCode.length/2;
        bytes memory first=new bytes(half);bytes memory second=new bytes(fullCode.length-half);
        for(uint256 i;i<half;i++)first[i]=fullCode[i];for(uint256 i=half;i<fullCode.length;i++)second[i-half]=fullCode[i];
        address part1=address(new RMTReclaimCodePartV2(first));address part2=address(new RMTReclaimCodePartV2(second));creationPart1=part1;creationPart2=part2;
        RMTReclaimCampaignDeployerV2 deployer=new RMTReclaimCampaignDeployerV2(token,hash,sink,part1,part2,keccak256(fullCode));
        campaignDeployer=address(deployer);campaignCreationCodeHash=deployer.campaignCreationCodeHash();
    }
    function retirementPolicy(bytes32 runtimeHash,uint8 standard,uint8 mode) external view returns(bytes32){return retirementPolicies[keccak256(abi.encode(runtimeHash,standard,mode))];}
    function saltFor(address creator,bytes32 intent) public view returns(bytes32){return keccak256(abi.encode(deploymentChainId,creator,intent));}
    function predict(address creator,bytes32 intent,address controller,uint128 rate,uint32 cap) external view returns(address){
        return RMTReclaimCampaignDeployerV2(campaignDeployer).predict(creator,intent,controller,rate,cap);
    }
    function create(bytes32 intent,address controller,uint128 rate,uint32 cap) external returns(address campaign){
        if(block.chainid!=deploymentChainId||rewardToken.codehash!=rewardRuntimeHash||intent==bytes32(0)||campaignForIntent[msg.sender][intent]!=address(0))revert InvalidConfiguration();
        campaign=RMTReclaimCampaignDeployerV2(campaignDeployer).deploy(msg.sender,intent,controller,rate,cap);
        campaignForIntent[msg.sender][intent]=campaign;emit CampaignCreated(msg.sender,campaign,intent,controller,rate,cap);
    }
}
