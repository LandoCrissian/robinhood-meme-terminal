// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTCommodityEvidenceRegistryV0} from "../src/RMTCommodityEvidenceRegistryV0.sol";
import {FinalizeCommodityEvidenceRegistryV0DeploymentPlan} from "../script/FinalizeCommodityEvidenceRegistryV0DeploymentPlan.s.sol";

interface CommodityEvidenceAddressPlanVm {
    function chainId(uint256 newChainId) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function readFile(string calldata path) external returns (string memory data);
}

contract RMTCommodityEvidenceRegistryV0AddressPlanTest {
    CommodityEvidenceAddressPlanVm private constant vm =
        CommodityEvidenceAddressPlanVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TARGET_CHAIN_ID = 46_630;
    address private constant ADMINISTRATOR = 0x1111111111111111111111111111111111111111;
    address private constant DEPLOYER = 0x2222222222222222222222222222222222222222;

    FinalizeCommodityEvidenceRegistryV0DeploymentPlan private planner;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        planner = new FinalizeCommodityEvidenceRegistryV0DeploymentPlan();
    }

    function testCreateAddressMatchesFoundryAcrossRlpBoundaries() public view {
        uint256[9] memory nonces = [
            uint256(0),
            uint256(1),
            uint256(0x7f),
            uint256(0x80),
            uint256(0xff),
            uint256(0x100),
            uint256(0xffff),
            uint256(0x1_0000),
            uint256(type(uint64).max)
        ];

        for (uint256 i = 0; i < nonces.length; i++) {
            address expected = vm.computeCreateAddress(DEPLOYER, nonces[i]);
            address actual = planner.computeCreateAddress(DEPLOYER, nonces[i]);
            require(actual == expected, "CREATE address mismatch");
        }
    }

    function testFinalPlanBindsDeployerNonceAdministratorAndPredictedDomain() public {
        uint256 deployerNonce = 42;
        FinalizeCommodityEvidenceRegistryV0DeploymentPlan.FinalDeploymentPlan memory plan =
            planner.run(ADMINISTRATOR, DEPLOYER, deployerNonce);

        bytes memory creationCode = type(RMTCommodityEvidenceRegistryV0).creationCode;
        bytes memory initCode = abi.encodePacked(creationCode, abi.encode(ADMINISTRATOR));
        address predictedRegistry = vm.computeCreateAddress(DEPLOYER, deployerNonce);
        bytes32 predictedDomainSeparator = keccak256(
            abi.encode(
                planner.EIP712_DOMAIN_TYPEHASH(),
                planner.EIP712_NAME_HASH(),
                planner.EIP712_VERSION_HASH(),
                TARGET_CHAIN_ID,
                predictedRegistry
            )
        );

        require(plan.chainId == TARGET_CHAIN_ID, "wrong chain");
        require(plan.administrator == ADMINISTRATOR, "wrong administrator");
        require(plan.deployer == DEPLOYER, "wrong deployer");
        require(plan.deployerNonce == deployerNonce, "wrong nonce");
        require(plan.predictedRegistry == predictedRegistry, "wrong predicted address");
        require(plan.creationCodeHash == keccak256(creationCode), "wrong creation hash");
        require(plan.initCodeHash == keccak256(initCode), "wrong init hash");
        require(plan.runtimeCodeHash == keccak256(plan.simulatedRegistry.code), "wrong runtime hash");
        require(plan.predictedDomainSeparator == predictedDomainSeparator, "wrong predicted domain");
        require(plan.creationCodeSize == creationCode.length, "wrong creation size");
        require(plan.initCodeSize == initCode.length, "wrong init size");
        require(plan.runtimeCodeSize == plan.simulatedRegistry.code.length, "wrong runtime size");
    }

    function testPlannerRejectsZeroActorsAndWrongChain() public {
        (bool zeroAdministratorAccepted,) = address(planner).call(
            abi.encodeWithSelector(planner.run.selector, address(0), DEPLOYER, uint256(1))
        );
        require(!zeroAdministratorAccepted, "zero administrator accepted");

        (bool zeroDeployerAccepted,) = address(planner).call(
            abi.encodeWithSelector(planner.run.selector, ADMINISTRATOR, address(0), uint256(1))
        );
        require(!zeroDeployerAccepted, "zero deployer accepted");

        vm.chainId(TARGET_CHAIN_ID + 1);
        (bool wrongChainAccepted,) = address(planner).call(
            abi.encodeWithSelector(planner.run.selector, ADMINISTRATOR, DEPLOYER, uint256(1))
        );
        require(!wrongChainAccepted, "wrong chain accepted");
    }

    function testPlannerSourceHasNoBroadcastOrSecretInterface() public {
        string memory source = vm.readFile("script/FinalizeCommodityEvidenceRegistryV0DeploymentPlan.s.sol");
        require(!_contains(source, "startBroadcast"), "broadcast interface present");
        require(!_contains(source, "vm.broadcast"), "broadcast interface present");
        require(!_contains(source, "envUint"), "secret environment read present");
        require(!_contains(source, "envBytes"), "secret environment read present");
        require(!_contains(source, "publishEvidence"), "evidence publication present");
    }

    function _contains(string memory haystack, string memory needle) private pure returns (bool) {
        bytes memory haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);
        if (needleBytes.length == 0 || needleBytes.length > haystackBytes.length) return false;

        for (uint256 i = 0; i <= haystackBytes.length - needleBytes.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
