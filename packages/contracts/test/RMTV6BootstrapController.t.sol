// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTV6BootstrapController} from "../src/RMTV6BootstrapController.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";

interface BootstrapVm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 balance) external;
    function chainId(uint256 newChainId) external;
}

contract RMTV6BootstrapControllerTest {
    BootstrapVm private constant vm = BootstrapVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;

    function testConstructorBindsExactPristineGovernanceAndFixedExpiry() public {
        vm.chainId(4_663);
        RMTV6Governance governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        uint256 deployedAt = block.timestamp;
        vm.prank(OPERATOR);
        RMTV6BootstrapController controller = new RMTV6BootstrapController(address(governance));

        require(controller.governance() == address(governance), "governance binding");
        require(controller.CHAIN_ID() == 4_663, "chain binding");
        require(controller.OPERATOR() == OPERATOR, "operator binding");
        require(controller.POOL_MANAGER() == 0x8366a39CC670B4001A1121B8F6A443A643e40951, "PoolManager binding");
        require(controller.INITIAL_VIRTUAL_ETH_RESERVE() == 0.3 ether, "virtual ETH binding");
        require(controller.INITIAL_VIRTUAL_TOKEN_RESERVE() == 1_017_500_000 ether, "virtual token binding");
        require(controller.V4_POOL_FEE() == 5_000, "V4 pool fee binding");
        require(controller.V4_TICK_SPACING() == 200, "V4 tick binding");
        require(controller.REQUIRED_HOOK_FLAGS() == 0x28a0, "hook flags binding");
        require(address(controller.foundationVerifier()).code.length != 0, "foundation verifier missing");
        require(address(controller.smokeVerifier()).code.length != 0, "smoke verifier missing");
        require(controller.foundationVerifier().controller() == address(controller), "foundation binding");
        require(controller.smokeVerifier().controller() == address(controller), "smoke binding");
        require(controller.expiresAt() == deployedAt + 12 hours, "fixed expiry");
        require(controller.bootstrapAvailable(), "bootstrap unavailable at deployment");
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Unbound, "wrong initial state");
    }

    function testWrongDeployerCannotCreateController() public {
        vm.chainId(4_663);
        RMTV6Governance governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        try new RMTV6BootstrapController(address(governance)) returns (RMTV6BootstrapController deployed) {
            require(address(deployed) == address(0), "wrong deployer created controller");
        } catch {}
    }

    function testGovernanceProposalMakesTopologyIneligible() public {
        vm.chainId(4_663);
        RMTV6Governance governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        vm.prank(OPERATOR);
        governance.propose(address(this), 0, "");

        vm.prank(OPERATOR);
        try new RMTV6BootstrapController(address(governance)) returns (RMTV6BootstrapController deployed) {
            require(address(deployed) == address(0), "non-pristine governance accepted");
        } catch {}
    }

    function testControllerCannotDeployOnAnotherChain() public {
        vm.chainId(1);
        RMTV6Governance governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        vm.prank(OPERATOR);
        try new RMTV6BootstrapController(address(governance)) returns (RMTV6BootstrapController deployed) {
            require(address(deployed) == address(0), "wrong-chain controller deployed");
        } catch {}
    }

    function testRuntimeBootstrapCannotCrossChains() public {
        RMTV6BootstrapController controller = _controller();
        vm.chainId(1);
        require(!controller.bootstrapAvailable(), "wrong-chain bootstrap reported available");

        vm.prank(OPERATOR);
        (bool activated,) = address(controller)
            .call(
                abi.encodeCall(
                    controller.activateVerifiedFoundation,
                    (address(1), address(2), address(3), address(4), keccak256("wrong-chain-source"))
                )
            );
        require(!activated, "runtime chain binding bypassed");
    }

    function testOnlyOperatorCanAbortAndAbortCannotBeReversed() public {
        RMTV6BootstrapController controller = _controller();
        (bool outsider,) = address(controller).call(abi.encodeCall(controller.abortBootstrap, ()));
        require(!outsider, "outsider aborted bootstrap");

        vm.prank(OPERATOR);
        controller.abortBootstrap();
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Aborted, "abort not final");
        require(!controller.bootstrapAvailable(), "aborted bootstrap available");

        vm.prank(OPERATOR);
        (bool replay,) = address(controller).call(abi.encodeCall(controller.abortBootstrap, ()));
        require(!replay, "abort replayed");
    }

    function testImmutableExpiryDisablesBootstrap() public {
        RMTV6BootstrapController controller = _controller();
        vm.warp(uint256(controller.expiresAt()) + 1);
        require(!controller.bootstrapAvailable(), "expired bootstrap reported available");
        controller.expireBootstrap();
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Aborted, "expiry not final");
    }

    function testZeroEvidenceAndWrongCallerCannotStartActivation() public {
        RMTV6BootstrapController controller = _controller();
        (bool outsider,) = address(controller)
            .call(
                abi.encodeCall(
                    controller.activateVerifiedFoundation,
                    (address(1), address(2), address(3), address(4), keccak256("source"))
                )
            );
        require(!outsider, "outsider started bootstrap");

        vm.prank(OPERATOR);
        (bool zeroEvidence,) = address(controller)
            .call(
                abi.encodeCall(
                    controller.activateVerifiedFoundation, (address(1), address(2), address(3), address(4), bytes32(0))
                )
            );
        require(!zeroEvidence, "zero source evidence accepted");
    }

    function testControllerRejectsEth() public {
        RMTV6BootstrapController controller = _controller();
        vm.deal(address(this), 1 ether);
        (bool funded,) = address(controller).call{value: 1 wei}("");
        require(!funded, "controller accepted ETH");
        require(address(controller).balance == 0, "controller retained ETH");
    }

    function _controller() private returns (RMTV6BootstrapController controller) {
        vm.chainId(4_663);
        RMTV6Governance governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        vm.prank(OPERATOR);
        controller = new RMTV6BootstrapController(address(governance));
    }
}
