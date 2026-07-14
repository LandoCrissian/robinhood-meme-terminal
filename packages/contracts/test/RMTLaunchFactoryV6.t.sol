// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";

interface FactoryVm {
    function prank(address caller) external;
}

contract MockV6LaunchGate {
    bool public launchesPaused;

    function setPaused(bool paused) external {
        launchesPaused = paused;
    }

    function requireLaunchesOpen() external view {
        require(!launchesPaused, "paused");
    }
}

contract MockV6LegacyIdentityFactory {
    bool public nameUsed;
    bool public symbolUsed;

    function setUsed(bool nameUsed_, bool symbolUsed_) external {
        nameUsed = nameUsed_;
        symbolUsed = symbolUsed_;
    }

    function isNameUsed(string calldata) external view returns (bool) {
        return nameUsed;
    }

    function isSymbolUsed(string calldata) external view returns (bool) {
        return symbolUsed;
    }
}

contract MockV6GraduationAdapter {
    mapping(address token => address market) public markets;

    function prepare(address token) external pure returns (bytes32) {
        return keccak256(abi.encode("RMT_V6_POOL", token));
    }

    function bindMarket(address token, address market) external {
        markets[token] = market;
    }

    function graduate(address, uint256) external payable returns (address pool, uint256 liquidity) {
        return (address(this), msg.value);
    }
}

contract MockV6PolicyRegistry is IRMTLaunchPolicyRegistry {
    LaunchPolicy private _policy;
    bytes32 public override defaultPolicyId;

    constructor(LaunchPolicy memory policy_) {
        _policy = policy_;
        defaultPolicyId = policy_.policyId;
    }

    function getPolicy(bytes32 policyId) external view returns (LaunchPolicy memory) {
        require(policyId == _policy.policyId, "unknown policy");
        return _policy;
    }

    function policyHash(bytes32 policyId) external view returns (bytes32) {
        return policyId == _policy.policyId ? keccak256(abi.encode(_policy)) : bytes32(0);
    }

    function isPolicyEnabled(bytes32 policyId) external view returns (bool) {
        return policyId == _policy.policyId && _policy.enabled;
    }
}

contract RMTLaunchFactoryV6Test {
    FactoryVm private constant vm = FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OFFICIAL_LAUNCHER = address(0xA11CE);
    address private constant ATTACKER = address(0xB0B);
    bytes32 private constant POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");

    function testOfficialRMTMigrationUsesNormalPipelineExactlyOnce() public {
        (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
        gate.setPaused(false);
        legacy.setUsed(true, true);

        vm.prank(OFFICIAL_LAUNCHER);
        (address token, address market,) = factory.launchSimple(
            "Robinhood Meme Terminal", "RMT", "ipfs://official-rmt-v6"
        );

        IRMTLaunchFactoryV6.LaunchView memory launchRecord = factory.getLaunch(0);
        require(launchRecord.token == token, "token record");
        require(launchRecord.market == market, "market record");
        require(launchRecord.creator == OFFICIAL_LAUNCHER, "official creator");
        require(launchRecord.officialMigration, "migration not recorded");
        require(factory.officialIdentityMigration().consumed(), "migration not consumed");
        require(CloneFixedSupplyMemeToken(token).balanceOf(market) == factory.TOKEN_SUPPLY(), "inventory not transferred");

        vm.prank(OFFICIAL_LAUNCHER);
        (bool secondSuccess,) = address(factory).call(
            abi.encodeCall(factory.launchSimple, ("Robinhood Meme Terminal", "RMT", "ipfs://second"))
        );
        require(!secondSuccess, "official migration reused");
    }

    function testUnauthorizedWalletCannotConsumeOfficialMigration() public {
        (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
        gate.setPaused(false);
        legacy.setUsed(true, true);

        vm.prank(ATTACKER);
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launchSimple, ("Robinhood Meme Terminal", "RMT", "ipfs://impersonation"))
        );

        require(!success, "unauthorized migration launched");
        require(!factory.officialIdentityMigration().consumed(), "unauthorized migration consumed");
        require(factory.launchCount() == 0, "unauthorized launch stored");
    }

    function testOfficialExceptionDoesNotBypassOtherLegacyIdentity() public {
        (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
        gate.setPaused(false);
        legacy.setUsed(true, true);

        vm.prank(OFFICIAL_LAUNCHER);
        (bool success,) = address(factory).call(
            abi.encodeCall(factory.launchSimple, ("Not The Official Token", "FAKE", "ipfs://wrong"))
        );

        require(!success, "non-official identity bypassed legacy protection");
        require(!factory.officialIdentityMigration().consumed(), "wrong identity consumed migration");
    }

    function testBothLaunchEntrypointsUseTheSharedPauseGate() public {
        (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate,) = _deploy();
        gate.setPaused(true);

        (bool simpleSuccess,) = address(factory).call(
            abi.encodeCall(factory.launchSimple, ("Paused Simple", "PAUS", "ipfs://paused-simple"))
        );
        (bool policySuccess,) = address(factory).call(
            abi.encodeCall(factory.launch, (POLICY_ID, "Paused Policy", "PAUP", "ipfs://paused-policy"))
        );

        require(!simpleSuccess, "launchSimple bypassed pause");
        require(!policySuccess, "launch bypassed pause");
        require(factory.launchCount() == 0, "paused launch stored");
    }

    function testOrdinaryLaunchDoesNotRecordMigration() public {
        (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate,) = _deploy();
        gate.setPaused(false);

        (address token,,) = factory.launchSimple("Ordinary Token", "ORD", "ipfs://ordinary");
        IRMTLaunchFactoryV6.LaunchView memory launchRecord = factory.getLaunch(0);

        require(token != address(0), "ordinary token missing");
        require(!launchRecord.officialMigration, "ordinary launch marked migration");
        require(!factory.officialIdentityMigration().consumed(), "ordinary launch consumed migration");
    }

    function _deploy()
        private
        returns (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy)
    {
        gate = new MockV6LaunchGate();
        legacy = new MockV6LegacyIdentityFactory();
        MockV6GraduationAdapter adapter = new MockV6GraduationAdapter();
        CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
        IRMTLaunchPolicyRegistry.LaunchPolicy memory policy = IRMTLaunchPolicyRegistry.LaunchPolicy({
            policyId: POLICY_ID,
            policyVersion: 1,
            enabled: true,
            publiclySelectable: true,
            curveFeeBps: 100,
            creatorFeeShareBps: 7_000,
            protocolFeeShareBps: 3_000,
            postGraduationFeeBps: 50,
            graduationTarget: 2 ether,
            fairStartMode: 0,
            fairStartDelayBlocks: 0,
            fairStartDurationBlocks: 0,
            fairStartMaxTxBps: 0,
            fairStartMaxWalletBps: 0,
            marketImplementation: address(marketImplementation),
            protocolTreasury: address(0x7E8E),
            graduationAdapter: address(adapter)
        });
        MockV6PolicyRegistry registry = new MockV6PolicyRegistry(policy);
        factory = new RMTLaunchFactoryV6(
            address(gate), address(registry), 0.3 ether, 1_017_500_000 ether, address(legacy), OFFICIAL_LAUNCHER
        );
    }
}
