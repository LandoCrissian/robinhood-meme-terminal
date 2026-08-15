// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";

interface CommodityEvidenceCreate2Vm {
    function chainId(uint256 newChainId) external;
}

/// @dev Test-only model of the canonical salt-plus-initcode CREATE2 deployment interface.
contract CommodityEvidenceCreate2FactoryHarness {
    fallback() external payable {
        assembly ("memory-safe") {
            if lt(calldatasize(), 33) { revert(0, 0) }
            let salt := calldataload(0)
            let initCodeSize := sub(calldatasize(), 32)
            let initCodePointer := mload(0x40)
            calldatacopy(initCodePointer, 32, initCodeSize)
            let deployed := create2(callvalue(), initCodePointer, initCodeSize, salt)
            if iszero(deployed) { revert(0, 0) }
            mstore(0, deployed)
            return(12, 20)
        }
    }
}

contract RMTCommodityEvidenceRegistryV0Create2ReadinessTest {
    CommodityEvidenceCreate2Vm private constant vm =
        CommodityEvidenceCreate2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    address private constant ADMINISTRATOR = 0x1111111111111111111111111111111111111111;
    bytes32 private constant RELEASE_SALT = keccak256("RMT_COMMODITY_EVIDENCE_REGISTRY_V0_RELEASE_TEST");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("RMTCommodityEvidenceRegistryV0");
    bytes32 private constant VERSION_HASH = keccak256("0");

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
    }

    function testSaltPlusInitCodeDeploysExactPredictedAddressAndRuntime() public {
        CommodityEvidenceCreate2FactoryHarness factory = new CommodityEvidenceCreate2FactoryHarness();
        bytes memory initCode = _initCode(ADMINISTRATOR);
        bytes32 initCodeHash = keccak256(initCode);
        address predicted = _create2Address(address(factory), RELEASE_SALT, initCodeHash);

        (bool success, bytes memory result) = address(factory).call(abi.encodePacked(RELEASE_SALT, initCode));
        require(success, "CREATE2 deployment failed");
        require(_addressFromReturnData(result) == predicted, "factory return address mismatch");
        require(predicted.code.length > 0, "predicted address has no runtime code");

        RMTCommodityEvidenceRegistryV0 registry = RMTCommodityEvidenceRegistryV0(payable(predicted));
        require(registry.administrator() == ADMINISTRATOR, "administrator mismatch");
        require(registry.TARGET_CHAIN_ID() == TARGET_CHAIN_ID, "target chain mismatch");
        require(registry.SYNTHETIC_ONLY(), "synthetic-only flag mismatch");
        require(
            registry.domainSeparator() == _domainSeparator(predicted),
            "domain separator is not bound to predicted address"
        );
        require(predicted.codehash == keccak256(predicted.code), "runtime code hash mismatch");
    }

    function testRuntimeHashBindsExactCreate2Address() public {
        CommodityEvidenceCreate2FactoryHarness firstFactory = new CommodityEvidenceCreate2FactoryHarness();
        CommodityEvidenceCreate2FactoryHarness secondFactory = new CommodityEvidenceCreate2FactoryHarness();
        bytes memory initCode = _initCode(ADMINISTRATOR);
        bytes32 initCodeHash = keccak256(initCode);
        address firstPredicted = _create2Address(address(firstFactory), RELEASE_SALT, initCodeHash);
        address secondPredicted = _create2Address(address(secondFactory), RELEASE_SALT, initCodeHash);

        (bool firstSuccess,) = address(firstFactory).call(abi.encodePacked(RELEASE_SALT, initCode));
        (bool secondSuccess,) = address(secondFactory).call(abi.encodePacked(RELEASE_SALT, initCode));
        require(firstSuccess && secondSuccess, "CREATE2 deployment failed");
        require(firstPredicted != secondPredicted, "predicted addresses unexpectedly equal");
        require(firstPredicted.codehash != secondPredicted.codehash, "runtime hash did not bind contract address");
        require(
            RMTCommodityEvidenceRegistryV0(payable(firstPredicted)).domainSeparator()
                != RMTCommodityEvidenceRegistryV0(payable(secondPredicted)).domainSeparator(),
            "domain separator did not bind contract address"
        );
    }

    function testSameSaltAndInitCodeCannotDeployTwice() public {
        CommodityEvidenceCreate2FactoryHarness factory = new CommodityEvidenceCreate2FactoryHarness();
        bytes memory deploymentCalldata = abi.encodePacked(RELEASE_SALT, _initCode(ADMINISTRATOR));
        (bool firstSuccess,) = address(factory).call(deploymentCalldata);
        (bool secondSuccess,) = address(factory).call(deploymentCalldata);
        require(firstSuccess, "first CREATE2 deployment failed");
        require(!secondSuccess, "duplicate CREATE2 deployment succeeded");
    }

    function testZeroAdministratorInitCodeFailsClosed() public {
        CommodityEvidenceCreate2FactoryHarness factory = new CommodityEvidenceCreate2FactoryHarness();
        (bool success,) = address(factory).call(abi.encodePacked(RELEASE_SALT, _initCode(address(0))));
        require(!success, "zero-administrator deployment succeeded");
    }

    function testConstructorStillRejectsEveryOtherChainThroughCreate2() public {
        CommodityEvidenceCreate2FactoryHarness factory = new CommodityEvidenceCreate2FactoryHarness();
        vm.chainId(TARGET_CHAIN_ID + 1);
        (bool success,) = address(factory).call(abi.encodePacked(RELEASE_SALT, _initCode(ADMINISTRATOR)));
        require(!success, "wrong-chain CREATE2 deployment succeeded");
        vm.chainId(TARGET_CHAIN_ID);
    }

    function _initCode(address administrator) private pure returns (bytes memory) {
        return abi.encodePacked(type(RMTCommodityEvidenceRegistryV0).creationCode, abi.encode(administrator));
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash)
        private
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _domainSeparator(address verifyingContract) private view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, verifyingContract)
        );
    }

    function _addressFromReturnData(bytes memory result) private pure returns (address deployed) {
        require(result.length == 20, "unexpected CREATE2 return length");
        assembly ("memory-safe") {
            deployed := shr(96, mload(add(result, 32)))
        }
    }
}
