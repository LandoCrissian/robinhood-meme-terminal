// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {NftAcquisitionTypes as T} from "./NftAcquisitionTypes.sol";
import {RMTNftAcquisitionVaultV1} from "./RMTNftAcquisitionVaultV1.sol";
contract NftAcquisitionCodePartV1 {constructor(bytes memory data){bytes memory runtime=bytes.concat(hex"00",data);assembly("memory-safe"){return(add(runtime,32),mload(runtime))}}}
contract NftAcquisitionDeployerV1 {
    address public immutable factory;address public immutable creationPart1;address public immutable creationPart2;bytes32 public immutable creationHash;bytes32 public immutable part1Hash;bytes32 public immutable part2Hash;
    constructor(address a,address b,bytes32 hash){factory=msg.sender;creationPart1=a;creationPart2=b;part1Hash=a.codehash;part2Hash=b.codehash;creationHash=hash;}
    function _creation() private view returns(bytes memory code){address a=creationPart1;address b=creationPart2;require(a.codehash==part1Hash&&b.codehash==part2Hash&&a.code.length>1&&b.code.length>1);uint256 x=a.code.length-1;uint256 y=b.code.length-1;code=new bytes(x+y);assembly("memory-safe"){extcodecopy(a,add(code,32),1,x)extcodecopy(b,add(add(code,32),x),1,y)}require(keccak256(code)==creationHash);}
    function _init(address creator,address token,address controller,bytes32 intent,T.Pins memory pins) private view returns(bytes memory){return bytes.concat(_creation(),abi.encode(creator,token,controller,intent,factory,pins));}
    function predict(address creator,address token,address controller,bytes32 intent,T.Pins memory pins) public view returns(address){bytes32 salt=keccak256(abi.encode(block.chainid,creator,intent));return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),salt,keccak256(_init(creator,token,controller,intent,pins)))))));}
    function deploy(address creator,address token,address controller,bytes32 intent,T.Pins memory pins) external returns(address vault){require(msg.sender==factory&&block.chainid==31337);bytes memory init=_init(creator,token,controller,intent,pins);bytes32 salt=keccak256(abi.encode(block.chainid,creator,intent));assembly("memory-safe"){vault:=create2(0,add(init,32),mload(init),salt)}require(vault!=address(0));}
}
contract RMTNftAcquisitionFactoryV1 {
    address public immutable coreFactory;bytes32 public immutable coreFactoryHash;bytes32 public immutable tokenRuntimeHash;
    address public immutable venue;bytes32 public immutable venueHash;address public immutable paymentToken;bytes32 public immutable paymentTokenHash;
    address public immutable vaultDeployer;uint256 public immutable deploymentChainId;mapping(address=>mapping(bytes32=>address))public vaultForIntent;
    address public immutable creationPart1;address public immutable creationPart2;bytes32 public immutable vaultCreationCodeHash;
    event VaultCreated(address indexed creator,address indexed projectToken,address indexed vault,address controller,bytes32 intent);
    constructor(T.Pins memory p){require(block.chainid==31337&&p.coreFactory.code.length!=0&&p.coreFactory.codehash==p.coreFactoryHash&&p.venue.code.length!=0&&p.venue.codehash==p.venueHash&&p.paymentToken.code.length!=0&&p.paymentToken.codehash==p.paymentTokenHash&&p.tokenRuntimeHash!=bytes32(0));coreFactory=p.coreFactory;coreFactoryHash=p.coreFactoryHash;tokenRuntimeHash=p.tokenRuntimeHash;venue=p.venue;venueHash=p.venueHash;paymentToken=p.paymentToken;paymentTokenHash=p.paymentTokenHash;deploymentChainId=block.chainid;
        bytes memory code=type(RMTNftAcquisitionVaultV1).creationCode;uint256 split=code.length/2;bytes memory a=new bytes(split);bytes memory b=new bytes(code.length-split);for(uint256 i;i<split;i++)a[i]=code[i];for(uint256 i;i<b.length;i++)b[i]=code[split+i];
        vaultCreationCodeHash=keccak256(code);creationPart1=address(new NftAcquisitionCodePartV1(a));creationPart2=address(new NftAcquisitionCodePartV1(b));vaultDeployer=address(new NftAcquisitionDeployerV1(creationPart1,creationPart2,vaultCreationCodeHash));}
    function _pins() private view returns(T.Pins memory){return T.Pins(coreFactory,coreFactoryHash,tokenRuntimeHash,venue,venueHash,paymentToken,paymentTokenHash);}
    function predict(address creator,address token,address controller,bytes32 intent) external view returns(address){return NftAcquisitionDeployerV1(vaultDeployer).predict(creator,token,controller,intent,_pins());}
    function create(address token,address controller,bytes32 intent) external returns(address vault){require(block.chainid==31337&&intent!=bytes32(0)&&vaultForIntent[msg.sender][intent]==address(0));vault=NftAcquisitionDeployerV1(vaultDeployer).deploy(msg.sender,token,controller,intent,_pins());vaultForIntent[msg.sender][intent]=vault;emit VaultCreated(msg.sender,token,vault,controller,intent);}
}
