// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RMTTreasuryPurchaseV2Prototype, IPurchaseTreasuryV1} from "./RMTTreasuryPurchaseV2Prototype.sol";

/// @notice Local-only deterministic deployment of a non-spending research sidecar.
contract RMTTreasuryPurchaseV2PrototypeFactory {
    mapping(address treasury => address prototype) public prototypeForTreasury;
    event PrototypeCreated(address indexed treasury, address indexed creator, address prototype, bytes32 salt);
    error InvalidCreation();
    constructor() { if (block.chainid != 31337) revert InvalidCreation(); }
    function saltFor(address treasury) public view returns (bytes32) {
        return keccak256(abi.encode("RMT_TREASURY_PURCHASE_V2_PROTOTYPE", block.chainid, treasury));
    }
    function predict(RMTTreasuryPurchaseV2Prototype.Binding calldata b) external view returns (address) {
        bytes32 initHash = keccak256(bytes.concat(type(RMTTreasuryPurchaseV2Prototype).creationCode, abi.encode(b)));
        return address(uint160(uint256(keccak256(bytes.concat(hex"ff", bytes20(address(this)), saltFor(b.treasury), initHash)))));
    }
    function create(RMTTreasuryPurchaseV2Prototype.Binding calldata b) external returns (address result) {
        if (block.chainid != 31337 || b.treasury == address(0) || b.treasuryHash == bytes32(0)
            || b.treasury.codehash != b.treasuryHash || IPurchaseTreasuryV1(b.treasury).creator() != msg.sender
            || prototypeForTreasury[b.treasury] != address(0)) revert InvalidCreation();
        bytes32 salt = saltFor(b.treasury);
        result = address(new RMTTreasuryPurchaseV2Prototype{salt:salt}(b));
        prototypeForTreasury[b.treasury] = result;
        emit PrototypeCreated(b.treasury,msg.sender,result,salt);
    }
}
