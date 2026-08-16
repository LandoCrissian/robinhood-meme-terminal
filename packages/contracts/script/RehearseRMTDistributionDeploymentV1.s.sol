// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTDistributionEngineV1} from "../src/RMTDistributionEngineV1.sol";
import {RMTRetirementSinkV1} from "../src/RMTRetirementSinkV1.sol";

interface DistributionRehearsalVm {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
}

/// @notice Rehearses the engine topology on a local Robinhood mainnet fork with synthetic rates.
/// @dev This script contains no broadcast cheatcode, private-key input, production rate input, or activation path.
contract RehearseRMTDistributionDeploymentV1 {
    DistributionRehearsalVm private constant vm =
        DistributionRehearsalVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OFFICIAL_RMT = 0xdBa33be56C89CC9fc014c4459028d7e5c7878671;
    bytes32 private constant OFFICIAL_RMT_RUNTIME_HASH =
        0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9;

    // Rehearsal-only values. They are deliberately not production policy.
    uint256 private constant SYNTHETIC_ERC20_RATE = 1 ether;
    uint256 private constant SYNTHETIC_ERC721_RATE = 2 ether;
    uint256 private constant SYNTHETIC_ERC1155_RATE = 3 ether;

    error RehearsalModeRequired();
    error WrongChain(uint256 actualChainId);
    error OfficialRmtRuntimeChanged(bytes32 actualRuntimeHash);
    error TopologyVerificationFailed();

    event DistributionDeploymentRehearsed(
        address indexed engine,
        address indexed retirementSink,
        bytes32 engineRuntimeHash,
        bytes32 retirementSinkRuntimeHash,
        uint256 syntheticErc20Rate,
        uint256 syntheticErc721Rate,
        uint256 syntheticErc1155Rate
    );

    function run() external returns (RMTDistributionEngineV1 engine, RMTRetirementSinkV1 sink) {
        if (!vm.envOr("RMT_DISTRIBUTION_DEPLOYMENT_REHEARSAL", false)) revert RehearsalModeRequired();
        if (block.chainid != 4_663) revert WrongChain(block.chainid);
        if (OFFICIAL_RMT.codehash != OFFICIAL_RMT_RUNTIME_HASH) {
            revert OfficialRmtRuntimeChanged(OFFICIAL_RMT.codehash);
        }

        sink = new RMTRetirementSinkV1();
        engine = new RMTDistributionEngineV1(
            OFFICIAL_RMT, address(sink), SYNTHETIC_ERC20_RATE, SYNTHETIC_ERC721_RATE, SYNTHETIC_ERC1155_RATE
        );

        if (
            engine.CHAIN_ID() != 4_663 || engine.rmtToken() != OFFICIAL_RMT
                || engine.rmtTokenRuntimeHash() != OFFICIAL_RMT_RUNTIME_HASH || engine.retirementSink() != address(sink)
                || engine.retirementSinkRuntimeHash() != address(sink).codehash
                || engine.erc20CostPerRecipient() != SYNTHETIC_ERC20_RATE
                || engine.erc721CostPerRecipient() != SYNTHETIC_ERC721_RATE
                || engine.erc1155CostPerRecipient() != SYNTHETIC_ERC1155_RATE
        ) revert TopologyVerificationFailed();

        emit DistributionDeploymentRehearsed(
            address(engine),
            address(sink),
            address(engine).codehash,
            address(sink).codehash,
            SYNTHETIC_ERC20_RATE,
            SYNTHETIC_ERC721_RATE,
            SYNTHETIC_ERC1155_RATE
        );
    }
}
