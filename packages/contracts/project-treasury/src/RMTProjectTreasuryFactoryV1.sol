// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolPins, ITreasuryFactoryCore, ITreasuryGraduation} from "./TreasuryInterfaces.sol";
import {RMTProjectTreasuryV1} from "./RMTProjectTreasuryV1.sol";

/// @notice Optional creator-owned sidecars. Never wraps the core create call.
contract RMTProjectTreasuryFactoryV1 {
    ProtocolPins public pins;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable treasuryCreationCodeHash;
    mapping(address creator => mapping(bytes32 intentId => address treasury)) public treasuryForIntent;

    error InvalidConfiguration();
    error InvalidIntent();
    error DuplicateIntent();
    event TreasuryCreated(address indexed creator, bytes32 indexed intentId, address indexed treasury, address controller, uint16 treasuryShareBps);

    constructor(ProtocolPins memory pins_) {
        if ((block.chainid != 31337 && block.chainid != 4663) || pins_.factory.code.length == 0
            || pins_.factory.codehash != pins_.factoryRuntimeHash || pins_.graduationEngine.code.length == 0
            || pins_.graduationEngine.codehash != pins_.graduationRuntimeHash || pins_.tokenRuntimeHash == bytes32(0)
            || ITreasuryFactoryCore(pins_.factory).graduationEngine() != pins_.graduationEngine
            || ITreasuryGraduation(pins_.graduationEngine).factory() != pins_.factory) revert InvalidConfiguration();
        pins = pins_;
        deploymentChainId = block.chainid;
        treasuryCreationCodeHash = keccak256(type(RMTProjectTreasuryV1).creationCode);
    }

    function salt(address creator, bytes32 intentId) public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("RMT_PROJECT_TREASURY_V1"), deploymentChainId, creator, intentId));
    }

    function predict(address creator, bytes32 intentId, address controller, uint16 treasuryShareBps, bytes calldata creationCode) public view returns (address) {
        bytes32 initHash = keccak256(_initCode(creator, intentId, controller, treasuryShareBps, creationCode));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt(creator, intentId), initHash)))));
    }

    function _initCode(address creator, bytes32 intentId, address controller, uint16 treasuryShareBps, bytes calldata creationCode) private view returns (bytes memory) {
        // Only the exact constructor-pinned template is admissible. Supplying
        // its public bytes avoids embedding >23KB inside the factory runtime.
        // This is not an arbitrary-code or arbitrary-call deployment facility.
        if (creationCode.length == 0 || creationCode.length > 32_768 || keccak256(creationCode) != treasuryCreationCodeHash) revert InvalidConfiguration();
        return abi.encodePacked(creationCode, abi.encode(creator, intentId, controller, treasuryShareBps, pins));
    }

    function create(bytes32 intentId, address controller, uint16 treasuryShareBps, bytes calldata creationCode) external returns (address treasury) {
        if (block.chainid != deploymentChainId || intentId == bytes32(0) || controller == address(0) || treasuryShareBps > 9000
            || ITreasuryFactoryCore(pins.factory).tokenForIntent(msg.sender, intentId) != address(0)) revert InvalidIntent();
        if (treasuryForIntent[msg.sender][intentId] != address(0)) revert DuplicateIntent();
        // No external controller callback, and only this creator can consume its key.
        bytes memory initCode = _initCode(msg.sender, intentId, controller, treasuryShareBps, creationCode);
        bytes32 deploymentSalt = salt(msg.sender, intentId);
        assembly ("memory-safe") { treasury := create2(0, add(initCode, 32), mload(initCode), deploymentSalt) }
        if (treasury == address(0)) revert InvalidConfiguration();
        RMTProjectTreasuryV1(payable(treasury)).initializeController();
        treasuryForIntent[msg.sender][intentId] = treasury;
        emit TreasuryCreated(msg.sender, intentId, treasury, controller, treasuryShareBps);
    }
}
