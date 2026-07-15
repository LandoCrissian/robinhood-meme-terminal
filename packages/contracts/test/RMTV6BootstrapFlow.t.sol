// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {RMTLaunchGate} from "../src/RMTLaunchGate.sol";
import {RMTLaunchPolicyRegistry} from "../src/RMTLaunchPolicyRegistry.sol";
import {RMTV6BootstrapController} from "../src/RMTV6BootstrapController.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";
import {VersionedFactoryRegistry} from "../src/VersionedFactoryRegistry.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";

interface BootstrapFlowVm {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract BootstrapFlowCodeMarker {}

contract BootstrapFlowHook {
    address public adapter;

    function poolManager() external pure returns (address) {
        return 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    }

    function deployer() external pure returns (address) {
        return 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    }

    function bindAdapter(address adapter_) external {
        adapter = adapter_;
    }
}

contract BootstrapFlowAdapter {
    address public immutable hook;
    address public factory;
    uint24 public constant poolFee = 5_000;
    int24 public constant tickSpacing = 200;

    constructor(address hook_) {
        hook = hook_;
    }

    function poolManager() external pure returns (address) {
        return 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    }

    function deployer() external pure returns (address) {
        return 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    }

    function bindFactory(address factory_) external {
        factory = factory_;
    }
}

contract BootstrapFlowMigration {
    address public constant officialLauncher = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address public immutable authorizedFactory;
    address public constant officialLegacyToken = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    bool public consumed;

    constructor(address authorizedFactory_) {
        authorizedFactory = authorizedFactory_;
    }

    function consume() external {
        consumed = true;
    }
}

contract BootstrapFlowFactory {
    bytes32 public constant FACTORY_VERSION = keccak256("RMT_FACTORY_V6");
    bytes32 public constant LEGACY_FACTORY_VERSION = keccak256("RMT_FACTORY_V5");
    bytes32 public constant OFFICIAL_MIGRATION_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
    address public constant legacyIdentityFactory = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address public constant officialLegacyToken = 0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C;
    uint256 public constant initialVirtualEthReserve = 0.3 ether;
    uint256 public constant initialVirtualTokenReserve = 1_017_500_000 ether;

    address public immutable launchGate;
    address public immutable policyRegistry;
    address public immutable factoryRegistry;
    address public immutable creatorPayoutAuthority;
    address public tokenImplementation;
    address public feeSplitterImplementation;
    BootstrapFlowMigration public officialIdentityMigration;
    IRMTLaunchFactoryV6.LaunchView[] private _launches;

    constructor(address launchGate_, address policyRegistry_, address factoryRegistry_, address governance_) {
        launchGate = launchGate_;
        policyRegistry = policyRegistry_;
        factoryRegistry = factoryRegistry_;
        creatorPayoutAuthority = governance_;
    }

    function finalizeFoundation() external {
        tokenImplementation = address(new BootstrapFlowCodeMarker());
        feeSplitterImplementation = address(new BootstrapFlowCodeMarker());
        officialIdentityMigration = new BootstrapFlowMigration(address(this));
    }

    function protocolVersion() external pure returns (uint32) {
        return 6;
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (IRMTLaunchFactoryV6.LaunchView memory) {
        return _launches[launchId];
    }

    function recordOfficial(address token, address market, address splitter) external {
        officialIdentityMigration.consume();
        _launches.push(
            IRMTLaunchFactoryV6.LaunchView({
                token: token,
                market: market,
                rewardVault: splitter,
                graduationPoolId: keccak256("LOCAL_OFFICIAL_POOL"),
                creator: 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA,
                policyId: OFFICIAL_MIGRATION_POLICY_ID,
                policyVersion: 1,
                createdAt: uint64(block.timestamp),
                officialMigration: true
            })
        );
    }
}

contract BootstrapFlowToken {
    string public name = "Robinhood Meme Terminal";
    string public symbol;
    uint256 public constant totalSupply = 1_000_000_000 ether;
    address public constant creator = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;

    constructor(string memory symbol_) {
        symbol = symbol_;
    }
}

contract BootstrapFlowMarket {
    address public immutable token;
    address public immutable graduationAdapter;
    address payable public feeSplitter;
    bytes32 public constant policyId = keccak256("RMT_SIMPLE_FAIR_V1");
    uint32 public constant policyVersion = 1;
    uint16 public constant feeBps = 100;
    uint256 public constant graduationTarget = 2 ether;
    bool public constant fairStartEnabled = true;
    uint64 public constant fairStartDelayBlocks = 1;
    uint64 public constant fairStartDurationBlocks = 10;
    uint16 public constant fairStartMaxTxBps = 100;
    uint16 public constant fairStartMaxWalletBps = 300;
    uint256 public constant curveInvariantK = 0.3 ether * 1_017_500_000 ether;

    uint256 public virtualEthReserve = 0.3 ether;
    uint256 public virtualTokenReserve = 1_017_500_000 ether;
    uint256 public realEthReserve;
    uint256 public trackedTokenInventory = 1_000_000_000 ether;
    bool public graduated;
    bool public liquidityMigrated;

    constructor(address token_, address graduationAdapter_) {
        token = token_;
        graduationAdapter = graduationAdapter_;
    }

    function bindFeeSplitter(address payable feeSplitter_) external {
        feeSplitter = feeSplitter_;
    }

    function buy() external payable {
        uint256 fee = msg.value / 100;
        uint256 netEth = msg.value - fee;
        realEthReserve += netEth;
        virtualEthReserve += netEth;
        uint256 nextVirtualTokenReserve = _ceilDiv(curveInvariantK, virtualEthReserve);
        uint256 tokensOut = virtualTokenReserve - nextVirtualTokenReserve;
        virtualTokenReserve = nextVirtualTokenReserve;
        trackedTokenInventory -= tokensOut;
        DirectLaunchFeeSplitter(feeSplitter).deposit{value: fee}();
    }

    function sell(uint256 tokensIn) external returns (uint256 ethOut) {
        uint256 nextVirtualTokenReserve = virtualTokenReserve + tokensIn;
        uint256 nextVirtualEthReserve = _ceilDiv(curveInvariantK, nextVirtualTokenReserve);
        uint256 grossEth = virtualEthReserve - nextVirtualEthReserve;
        uint256 fee = grossEth / 100;
        ethOut = grossEth - fee;
        require(grossEth <= realEthReserve, "insufficient reserve");

        virtualTokenReserve = nextVirtualTokenReserve;
        virtualEthReserve = nextVirtualEthReserve;
        realEthReserve -= grossEth;
        trackedTokenInventory += tokensIn;
        DirectLaunchFeeSplitter(feeSplitter).deposit{value: fee}();
        (bool success,) = payable(msg.sender).call{value: ethOut}("");
        require(success, "sell payout");
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }

    function markGraduated() external {
        graduated = true;
        liquidityMigrated = true;
    }
}

contract BootstrapFlowForceEther {
    constructor() payable {}

    function force(address payable target) external {
        selfdestruct(target);
    }
}

contract RMTV6BootstrapFlowTest {
    BootstrapFlowVm private constant vm = BootstrapFlowVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OPERATOR = 0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA;
    address private constant LEGACY_FACTORY = 0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD;
    address private constant HOOK = address(0x28a0);

    RMTV6Governance private governance;
    RMTV6BootstrapController private controller;
    RMTLaunchGate private gate;
    BootstrapFlowAdapter private adapter;
    RMTLaunchPolicyRegistry private policies;
    VersionedFactoryRegistry private registry;
    BootstrapFlowFactory private factory;

    receive() external payable {}

    function setUp() public {
        vm.chainId(4_663);
        vm.deal(address(this), 100 ether);
        vm.etch(LEGACY_FACTORY, hex"00");

        BootstrapFlowHook hookTemplate = new BootstrapFlowHook();
        vm.etch(HOOK, address(hookTemplate).code);
        adapter = new BootstrapFlowAdapter(HOOK);
        BootstrapFlowHook(HOOK).bindAdapter(address(adapter));

        governance = new RMTV6Governance(OPERATOR, 1 days, 7 days);
        vm.prank(OPERATOR);
        controller = new RMTV6BootstrapController(address(governance));
        gate = new RMTLaunchGate(address(governance), OPERATOR, 1 days, address(controller));
        BootstrapFlowCodeMarker marketImplementation = new BootstrapFlowCodeMarker();
        policies = new RMTLaunchPolicyRegistry(
            address(governance), OPERATOR, 1 days, address(governance), address(marketImplementation), address(adapter)
        );
        registry = new VersionedFactoryRegistry(
            address(governance), 2 days, LEGACY_FACTORY, keccak256("RMT_FACTORY_V5"), address(controller)
        );
        factory = new BootstrapFlowFactory(address(gate), address(policies), address(registry), address(governance));
        factory.finalizeFoundation();
        adapter.bindFactory(address(factory));
    }

    function testLocalActivateOfficialBuyAndOpen() public {
        _activate();
        (BootstrapFlowMarket market,) = _recordOfficialAndBuy("RMT");

        vm.prank(OPERATOR);
        controller.openAfterOfficialSmoke(keccak256("local-curve-smoke"));

        require(!gate.launchesPaused(), "public gate remained paused");
        require(gate.bootstrapConsumed(), "gate bootstrap latch not consumed");
        require(registry.bootstrapConsumed(), "registry bootstrap latch not consumed");
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Complete, "bootstrap incomplete");
        require(market.realEthReserve() != 0 && !market.graduated(), "not a pre-graduation buy");
        require(
            market.curveInvariantK() % market.virtualEthReserve() != 0,
            "smoke buy did not exercise non-divisible invariant rounding"
        );

        vm.prank(OPERATOR);
        (bool replay,) =
            address(controller).call(abi.encodeCall(controller.openAfterOfficialSmoke, (keccak256("replay"))));
        require(!replay, "bootstrap replayed");
    }

    function testBuyThenPartialSellStillOpens() public {
        _activate();
        (BootstrapFlowMarket market, DirectLaunchFeeSplitter splitter) = _recordOfficialAndBuy("RMT");
        uint256 reserveBeforeSell = market.realEthReserve();
        market.sell(1 ether);
        require(market.realEthReserve() != 0 && market.realEthReserve() < reserveBeforeSell, "partial sell state");
        require(
            market.virtualTokenReserve() != _ceilDiv(market.curveInvariantK(), market.virtualEthReserve()),
            "sell did not exercise opposite-direction rounding"
        );
        require(splitter.totalReceived() != 0 && splitter.totalPaid() == splitter.totalReceived(), "fees unsettled");

        vm.prank(OPERATOR);
        controller.openAfterOfficialSmoke(keccak256("buy-partial-sell-smoke"));
        require(!gate.launchesPaused(), "partial sell blocked public opening");
    }

    function testCounterfeitFoundationRollsBackActivation() public {
        adapter.bindFactory(address(0xBAD));
        vm.prank(OPERATOR);
        (bool activated,) = address(controller)
            .call(
                abi.encodeCall(
                    controller.activateVerifiedFoundation,
                    (address(registry), address(gate), address(policies), address(factory), keccak256("counterfeit"))
                )
            );
        require(!activated, "counterfeit foundation activated");
        require(registry.activeFactory() == LEGACY_FACTORY, "failed activation changed registry");
        require(!registry.bootstrapConsumed(), "failed activation consumed registry latch");
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Unbound, "failed state persisted");
        require(controller.sourceEvidenceHash() == bytes32(0), "failed evidence persisted");
    }

    function testCounterfeitOfficialTokenCannotOpen() public {
        _activate();
        _recordOfficialAndBuy("FAKE");

        vm.prank(OPERATOR);
        (bool opened,) = address(controller)
            .call(abi.encodeCall(controller.openAfterOfficialSmoke, (keccak256("counterfeit-token"))));
        require(!opened, "counterfeit token opened launches");
        require(gate.launchesPaused(), "counterfeit failure opened gate");
        require(controller.smokeEvidenceHash() == bytes32(0), "counterfeit evidence persisted");
    }

    function testGraduatedAdapterFeeStateCannotMasqueradeAsCurveSmoke() public {
        _activate();
        (BootstrapFlowMarket market,) = _recordOfficialAndBuy("RMT");
        market.markGraduated();

        vm.prank(OPERATOR);
        (bool opened,) = address(controller)
            .call(abi.encodeCall(controller.openAfterOfficialSmoke, (keccak256("graduated-adapter-fees"))));
        require(!opened, "graduated market satisfied curve smoke");
        require(gate.launchesPaused(), "graduated smoke opened gate");
    }

    function testForcedEtherCannotChangeOrBlockBootstrap() public {
        BootstrapFlowForceEther force = new BootstrapFlowForceEther{value: 1 wei}();
        force.force(payable(address(controller)));
        require(address(controller).balance == 1 wei, "forced ETH missing");

        _activate();
        _recordOfficialAndBuy("RMT");
        vm.prank(OPERATOR);
        controller.openAfterOfficialSmoke(keccak256("forced-ether-safe"));
        require(!gate.launchesPaused(), "forced ETH blocked opening");
        require(address(controller).balance == 1 wei, "controller moved forced ETH");
    }

    function testForcedEtherWithoutBuyCannotSatisfySmoke() public {
        _activate();
        (BootstrapFlowMarket market, DirectLaunchFeeSplitter splitter) = _recordOfficial("RMT");
        BootstrapFlowForceEther forceMarket = new BootstrapFlowForceEther{value: 1 wei}();
        BootstrapFlowForceEther forceSplitter = new BootstrapFlowForceEther{value: 1 wei}();
        forceMarket.force(payable(address(market)));
        forceSplitter.force(payable(address(splitter)));

        vm.prank(OPERATOR);
        (bool opened,) =
            address(controller).call(abi.encodeCall(controller.openAfterOfficialSmoke, (keccak256("forced-no-buy"))));
        require(!opened, "forced ETH satisfied smoke without a buy");
        require(gate.launchesPaused(), "forced ETH opened gate without a buy");
        require(splitter.totalReceived() == 0, "forced ETH was accounted as a fee");
    }

    function testExpiryRollsBackOpeningAndCanBeFinalized() public {
        _activate();
        _recordOfficialAndBuy("RMT");
        vm.warp(uint256(controller.expiresAt()) + 1);

        vm.prank(OPERATOR);
        (bool opened,) =
            address(controller).call(abi.encodeCall(controller.openAfterOfficialSmoke, (keccak256("expired-smoke"))));
        require(!opened, "expired bootstrap opened gate");
        require(gate.launchesPaused(), "expired bootstrap changed gate");
        require(controller.smokeEvidenceHash() == bytes32(0), "expired evidence persisted");
        require(
            controller.state() == RMTV6BootstrapController.BootstrapState.OfficialPending, "expired call changed state"
        );

        controller.expireBootstrap();
        require(controller.state() == RMTV6BootstrapController.BootstrapState.Aborted, "expiry not finalized");
    }

    function _activate() private {
        vm.prank(OPERATOR);
        controller.activateVerifiedFoundation(
            address(registry), address(gate), address(policies), address(factory), keccak256("local-source-evidence")
        );
        require(registry.activeFactory() == address(factory), "V6 not activated");
        require(gate.launchesPaused(), "activation opened public gate");
    }

    function _recordOfficialAndBuy(string memory symbol)
        private
        returns (BootstrapFlowMarket market, DirectLaunchFeeSplitter splitter)
    {
        (market, splitter) = _recordOfficial(symbol);
        market.buy{value: 0.01 ether}();
        require(splitter.totalReceived() != 0, "curve fee missing");
        require(splitter.totalPaid() == splitter.totalReceived(), "curve fee not paid");
    }

    function _recordOfficial(string memory symbol)
        private
        returns (BootstrapFlowMarket market, DirectLaunchFeeSplitter splitter)
    {
        BootstrapFlowToken token = new BootstrapFlowToken(symbol);
        market = new BootstrapFlowMarket(address(token), address(adapter));
        splitter = new DirectLaunchFeeSplitter();
        splitter.initialize(
            payable(OPERATOR),
            payable(address(governance)),
            address(token),
            7_000,
            address(governance),
            address(market),
            address(adapter)
        );
        market.bindFeeSplitter(payable(address(splitter)));
        factory.recordOfficial(address(token), address(market), address(splitter));
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : ((numerator - 1) / denominator) + 1;
    }
}
