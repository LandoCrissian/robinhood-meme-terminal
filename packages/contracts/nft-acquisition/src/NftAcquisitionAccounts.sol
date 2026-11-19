// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
interface IAcquisitionSafe {function VERSION()external view returns(string memory);function masterCopy()external view returns(address);function getOwners()external view returns(address[] memory);function getThreshold()external view returns(uint256);function getModulesPaginated(address,uint256)external view returns(address[] memory,address);function getStorageAt(uint256,uint256)external view returns(bytes memory);}
library NftAcquisitionAccounts {
    function supported(address who) internal view returns(bool){
        if(uint160(who)<=0xffff)return false;if(who.code.length==0)return true;
        if(keccak256(who.code)==keccak256(hex"ef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"))return address(0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B).codehash==0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0;
        if(who.codehash!=0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c)return false;
        if(address(0x29fcB43b46531BcA003ddC8FCB67FFE91900C762).codehash!=0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff||address(0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99).codehash!=0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9)return false;
        IAcquisitionSafe safe=IAcquisitionSafe(who);
        if(keccak256(bytes(safe.VERSION()))!=keccak256("1.4.1")||safe.masterCopy()!=0x29fcB43b46531BcA003ddC8FCB67FFE91900C762||safe.getThreshold()!=2)return false;
        address[] memory owners=safe.getOwners();if(owners.length!=3)return false;
        for(uint256 i;i<3;i++){if(uint160(owners[i])<=0xffff||owners[i].code.length!=0)return false;for(uint256 j;j<i;j++)if(owners[j]==owners[i])return false;}
        (address[] memory modules,address next)=safe.getModulesPaginated(address(1),1);if(modules.length!=0||next!=address(1))return false;
        bytes memory guard=safe.getStorageAt(uint256(0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8),1);
        bytes memory handler=safe.getStorageAt(uint256(0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5),1);
        return guard.length==32&&abi.decode(guard,(bytes32))==bytes32(0)&&handler.length==32&&abi.decode(handler,(bytes32))==bytes32(uint256(uint160(address(0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99))));
    }
}
