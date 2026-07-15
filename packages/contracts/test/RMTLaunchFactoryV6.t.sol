// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RMTLaunchFactoryV6} from "../src/RMTLaunchFactoryV6.sol";
import {CloneBondingCurveMarketV6} from "../src/clone/CloneBondingCurveMarketV6.sol";
import {CloneFixedSupplyMemeToken} from "../src/clone/CloneFixedSupplyMemeToken.sol";
import {DirectLaunchFeeSplitter} from "../src/DirectLaunchFeeSplitter.sol";
import {IRMTLaunchFactoryV6} from "../src/interfaces/IRMTLaunchFactoryV6.sol";
import {IRMTLaunchPolicyRegistry} from "../src/interfaces/IRMTLaunchPolicyRegistry.sol";

interface FactoryVm {
    function prank(address caller) external;
    function deal(address account, uint256 balance) external;
}

contract MockV6LaunchGate {
    bool public launchesPaused;
    address public governance;

    constructor(address governance_) {
        governance = governance_;
    }

    function setPaused(bool paused) external {
        launchesPaused = paused;
    }

    function requireLaunchesOpen() external view {
        require(!launchesPaused, "paused");
    }
}

contract MockV6LegacyIdentityFactory {
    mapping(bytes32 nameHash => bool used) private _usedNames;
    mapping(bytes32 symbolHash => bool used) private _usedSymbols;

    function setUsed(bool nameUsed_, bool symbolUsed_) external {
        _usedNames[keccak256(bytes("Robinhood Meme Terminal"))] = nameUsed_;
        _usedSymbols[keccak256(bytes("RMT"))] = symbolUsed_;
    }

    function setNameUsed(string calldata name, bool used) external {
        _usedNames[keccak256(bytes(name))] = used;
    }

    function setSymbolUsed(string calldata symbol, bool used) external {
        _usedSymbols[keccak256(bytes(symbol))] = used;
    }

    function isNameUsed(string calldata name) external view returns (bool) {
        return _usedNames[keccak256(bytes(name))];
    }

    function isSymbolUsed(string calldata symbol) external view returns (bool) {
        return _usedSymbols[keccak256(bytes(symbol))];
    }
}

contract MockV6OfficialLegacyToken {
    string public name;
    string public symbol;
    address public creator;

    constructor(string memory name_, string memory symbol_, address creator_) {
        name = name_;
        symbol = symbol_;
        creator = creator_;
    }
}

contract MockV6FactoryRegistry {
    address public activeFactory;
    bytes32 public activeVersion;
    address public governance;

    constructor(address governance_, address initialFactory_, bytes32 initialVersion_) {
        governance = governance_;
        activeFactory = initialFactory_;
        activeVersion = initialVersion_;
    }

    function setActiveFactory(address factory, bytes32 version) external {
        activeFactory = factory;
        activeVersion = version;
    }

    function setGovernance(address governance_) external {
        governance = governance_;
    }
}

contract MockV6GraduationAdapter {
    mapping(address token => address market) public markets;
    mapping(address token => address splitter) public feeSplitters;
    uint24 public constant poolFee = 5_000;

    function prepare(address token) external pure returns (bytes32) {
        return keccak256(abi.encode("RMT_V6_POOL", token));
    }

    function bindMarket(address token, address market) external {
        address splitter = feeSplitters[token];
        if (splitter != address(0)) {
            require(DirectLaunchFeeSplitter(payable(splitter)).authorizedMarket() == market, "wrong splitter market");
        }
        markets[token] = market;
    }

    function configureFeeRouting(address token, address feeSplitter, uint16 postGraduationFeeBps) external {
        require(postGraduationFeeBps == 50, "wrong post graduation fee");
        require(DirectLaunchFeeSplitter(payable(feeSplitter)).launchToken() == token, "wrong splitter token");
        require(
            DirectLaunchFeeSplitter(payable(feeSplitter)).graduationAdapter() == address(this), "wrong splitter adapter"
        );
        feeSplitters[token] = feeSplitter;
    }

    function collectFees(address) external pure returns (uint256 nativeAmount, uint256 tokenAmount) {
        return (0, 0);
    }

    function graduate(address, uint256) external payable returns (address pool, uint256 liquidity) {
        return (address(this), msg.value);
    }
}

contract MockV6CreatorPayoutAuthority {
    receive() external payable {}

    function setCreator(
        DirectLaunchFeeSplitter splitter,
        address payable nextCreator,
        bytes32 evidenceHash,
        uint256 expectedNonce
    ) external {
        splitter.setCreatorWallet(nextCreator, evidenceHash, expectedNonce);
    }
}

contract MockV6PolicyRegistry is IRMTLaunchPolicyRegistry {
    mapping(bytes32 policyId => LaunchPolicy policy) private _policies;
    bytes32 public override defaultPolicyId;
    address public override governance;
    address public override canonicalProtocolTreasury;
    address public immutable override canonicalMarketImplementation;
    address public immutable override canonicalGraduationAdapter;

    constructor(LaunchPolicy memory fairPolicy, LaunchPolicy memory openPolicy, address governance_) {
        require(fairPolicy.marketImplementation == openPolicy.marketImplementation, "canonical market mismatch");
        require(fairPolicy.graduationAdapter == openPolicy.graduationAdapter, "canonical adapter mismatch");
        require(fairPolicy.protocolTreasury == openPolicy.protocolTreasury, "canonical treasury mismatch");
        _policies[fairPolicy.policyId] = fairPolicy;
        _policies[openPolicy.policyId] = openPolicy;
        defaultPolicyId = fairPolicy.policyId;
        governance = governance_;
        canonicalProtocolTreasury = fairPolicy.protocolTreasury;
        canonicalMarketImplementation = fairPolicy.marketImplementation;
        canonicalGraduationAdapter = fairPolicy.graduationAdapter;
    }

    function setCanonicalProtocolTreasury(address treasury) external {
        canonicalProtocolTreasury = treasury;
    }

    function getPolicy(bytes32 policyId) external view returns (LaunchPolicy memory) {
        LaunchPolicy memory policy = _policies[policyId];
        require(policy.policyId != bytes32(0), "unknown policy");
        return policy;
    }

    function policyHash(bytes32 policyId) external view returns (bytes32) {
        LaunchPolicy memory policy = _policies[policyId];
        return policy.policyId == bytes32(0) ? bytes32(0) : keccak256(abi.encode(policy));
    }

    function isPolicyEnabled(bytes32 policyId) external view returns (bool) {
        return _policies[policyId].enabled;
    }
}

    contract RMTLaunchFactoryV6Test {
        FactoryVm private constant vm = FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
        address private constant OFFICIAL_LAUNCHER = address(0xA11CE);
        address private constant ATTACKER = address(0xB0B);
        bytes32 private constant FAIR_POLICY_ID = keccak256("RMT_SIMPLE_FAIR_V1");
        bytes32 private constant OPEN_POLICY_ID = keccak256("RMT_SIMPLE_OPEN_V1");

        receive() external payable {}

        function testFactoryBindsExactOfficialLegacyTokenProvenance() public {
            (RMTLaunchFactoryV6 factory,,) = _deploy();
            address legacyToken = factory.officialLegacyToken();

            require(legacyToken.code.length != 0, "official legacy token code");
            require(
                factory.officialIdentityMigration().officialLegacyToken() == legacyToken, "migration token mismatch"
            );
            require(MockV6OfficialLegacyToken(legacyToken).creator() == OFFICIAL_LAUNCHER, "legacy creator");
            require(
                keccak256(bytes(MockV6OfficialLegacyToken(legacyToken).name()))
                    == keccak256(bytes("Robinhood Meme Terminal")),
                "legacy name"
            );
            require(
                keccak256(bytes(MockV6OfficialLegacyToken(legacyToken).symbol())) == keccak256(bytes("RMT")),
                "legacy symbol"
            );
            address governance = factory.creatorPayoutAuthority();
            require(factory.launchGate().governance() == governance, "gate governance");
            require(factory.policyRegistry().governance() == governance, "policy governance");
            require(factory.policyRegistry().canonicalProtocolTreasury() == governance, "protocol treasury");
            require(factory.factoryRegistry().governance() == governance, "registry governance");
        }

        function testFactoryRejectsVersionRegistryGovernedByDifferentAuthority() public {
            (RMTLaunchFactoryV6 factory,,) = _deploy();
            MockV6FactoryRegistry registry = MockV6FactoryRegistry(address(factory.factoryRegistry()));
            registry.setActiveFactory(factory.legacyIdentityFactory(), factory.LEGACY_FACTORY_VERSION());
            registry.setGovernance(ATTACKER);
            require(!_bindingCandidateDeploys(factory), "mismatched registry governance accepted");
        }

        function testFactoryRejectsProtocolTreasuryOutsideSharedGovernance() public {
            (RMTLaunchFactoryV6 factory,,) = _deploy();
            MockV6FactoryRegistry(address(factory.factoryRegistry()))
                .setActiveFactory(factory.legacyIdentityFactory(), factory.LEGACY_FACTORY_VERSION());
            MockV6PolicyRegistry(address(factory.policyRegistry())).setCanonicalProtocolTreasury(ATTACKER);
            require(!_bindingCandidateDeploys(factory), "mismatched protocol treasury accepted");
        }

        function testFactoryRejectsRegistryStartingFromDifferentFactory() public {
            (RMTLaunchFactoryV6 source,,) = _deploy();
            MockV6FactoryRegistry(address(source.factoryRegistry()))
                .setActiveFactory(ATTACKER, source.LEGACY_FACTORY_VERSION());
            require(!_bindingCandidateDeploys(source), "wrong initial factory accepted");
        }

        function testFactoryRejectsRegistryStartingFromDifferentVersion() public {
            (RMTLaunchFactoryV6 source,,) = _deploy();
            MockV6FactoryRegistry(address(source.factoryRegistry()))
                .setActiveFactory(source.legacyIdentityFactory(), keccak256("NOT_RMT_FACTORY_V5"));
            require(!_bindingCandidateDeploys(source), "wrong initial version accepted");
        }

        function testFactoryRejectsOfficialLegacyAddressWithoutCode() public {
            require(!_candidateDeploySucceeds(address(0x1234)), "no-code official token accepted");
        }

        function testFactoryRejectsOfficialLegacyTokenWithWrongCreator() public {
            MockV6OfficialLegacyToken candidate = new MockV6OfficialLegacyToken(
                "Robinhood Meme Terminal", "RMT", ATTACKER
            );
            require(!_candidateDeploySucceeds(address(candidate)), "wrong legacy creator accepted");
        }

        function testFactoryRejectsOfficialLegacyTokenWithWrongName() public {
            MockV6OfficialLegacyToken candidate = new MockV6OfficialLegacyToken("Not RMT", "RMT", OFFICIAL_LAUNCHER);
            require(!_candidateDeploySucceeds(address(candidate)), "wrong legacy name accepted");
        }

        function testFactoryRejectsOfficialLegacyTokenWithWrongSymbol() public {
            MockV6OfficialLegacyToken candidate =
                new MockV6OfficialLegacyToken("Robinhood Meme Terminal", "FAKE", OFFICIAL_LAUNCHER);
            require(!_candidateDeploySucceeds(address(candidate)), "wrong legacy symbol accepted");
        }

        function testOfficialRMTMigrationUsesNormalPipelineExactlyOnce() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);

            vm.prank(OFFICIAL_LAUNCHER);
            (address token, address market, address splitterAddress) =
                factory.launchOfficialWhilePaused("ipfs://official-rmt-v6");
            DirectLaunchFeeSplitter splitter = DirectLaunchFeeSplitter(payable(splitterAddress));

            IRMTLaunchFactoryV6.LaunchView memory launchRecord = factory.getLaunch(0);
            require(launchRecord.token == token, "token record");
            require(launchRecord.market == market, "market record");
            require(launchRecord.creator == OFFICIAL_LAUNCHER, "official creator");
            require(launchRecord.officialMigration, "migration not recorded");
            require(factory.officialIdentityMigration().consumed(), "migration not consumed");
            require(
                CloneFixedSupplyMemeToken(token).balanceOf(market) == factory.TOKEN_SUPPLY(),
                "inventory not transferred"
            );
            require(CloneFixedSupplyMemeToken(token).balanceOf(OFFICIAL_LAUNCHER) == 0, "creator token allocation");
            require(splitter.authorizedMarket() == market, "splitter market source");
            require(
                splitter.graduationAdapter() == address(CloneBondingCurveMarketV6(payable(market)).graduationAdapter()),
                "splitter adapter source"
            );

            vm.prank(OFFICIAL_LAUNCHER);
            (bool secondSuccess,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://second")));
            require(!secondSuccess, "official migration reused");
        }

        function testOfficialRMTCanLaunchOnceWhilePublicGateRemainsPaused() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);

            vm.prank(ATTACKER);
            (bool attackerSuccess,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://attacker")));
            require(!attackerSuccess, "attacker used paused official migration");

            vm.prank(OFFICIAL_LAUNCHER);
            (address token, address market,) = factory.launchOfficialWhilePaused("ipfs://official-paused");
            require(token != address(0) && market != address(0), "paused official launch missing");
            require(gate.launchesPaused(), "official migration reopened public launches");
            require(factory.officialIdentityMigration().consumed(), "paused migration not consumed");

            (bool ordinarySuccess,) =
                address(factory).call(abi.encodeCall(factory.launchSimple, ("Still Paused", "STOP", "ipfs://blocked")));
            require(!ordinarySuccess, "ordinary launch bypassed paused gate");

            vm.prank(OFFICIAL_LAUNCHER);
            (bool repeatedSuccess,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://repeated")));
            require(!repeatedSuccess, "paused official migration reused");
        }

        function testInactiveFactoryCannotLaunchOrConsumeOfficialMigration() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);
            MockV6FactoryRegistry(address(factory.factoryRegistry()))
                .setActiveFactory(address(0xDEAD), factory.FACTORY_VERSION());

            (bool ordinarySuccess,) =
                address(factory)
                    .call(abi.encodeCall(factory.launchSimple, ("Inactive Factory", "OLD", "ipfs://inactive")));
            vm.prank(OFFICIAL_LAUNCHER);
            (bool officialSuccess,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://inactive-rmt")));

            require(!ordinarySuccess && !officialSuccess, "inactive factory launched");
            require(factory.launchCount() == 0, "inactive launch stored");
            require(!factory.officialIdentityMigration().consumed(), "inactive factory consumed migration");
        }

        function testWrongActiveVersionCannotLaunchOrConsumeOfficialMigration() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);
            MockV6FactoryRegistry(address(factory.factoryRegistry()))
                .setActiveFactory(address(factory), keccak256("WRONG_VERSION"));

            vm.prank(OFFICIAL_LAUNCHER);
            (bool officialSuccess,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://wrong-version")));

            require(!officialSuccess, "wrong version launched");
            require(factory.launchCount() == 0, "wrong-version launch stored");
            require(!factory.officialIdentityMigration().consumed(), "wrong version consumed migration");
        }

        function testUnauthorizedWalletCannotConsumeOfficialMigration() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);

            vm.prank(ATTACKER);
            (bool success,) =
                address(factory).call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://impersonation")));

            require(!success, "unauthorized migration launched");
            require(!factory.officialIdentityMigration().consumed(), "unauthorized migration consumed");
            require(factory.launchCount() == 0, "unauthorized launch stored");
        }

        function testOfficialRMTMigrationCannotConsumeIdentityThroughOpenPolicy() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, true);

            require(
                !factory.canMigrateOfficialIdentity(
                    OFFICIAL_LAUNCHER, OPEN_POLICY_ID, "Robinhood Meme Terminal", "RMT"
                ),
                "open policy advertised official migration"
            );
            require(
                factory.canMigrateOfficialIdentity(OFFICIAL_LAUNCHER, FAIR_POLICY_ID, "Robinhood Meme Terminal", "RMT"),
                "fair policy migration unavailable"
            );

            vm.prank(OFFICIAL_LAUNCHER);
            (bool openSuccess,) = address(factory)
                .call(
                    abi.encodeCall(
                        factory.launch, (OPEN_POLICY_ID, "Robinhood Meme Terminal", "RMT", "ipfs://wrong-open-policy")
                    )
                );
            require(!openSuccess, "official migration consumed through open policy");
            require(!factory.officialIdentityMigration().consumed(), "open policy consumed migration");

            vm.prank(OFFICIAL_LAUNCHER);
            factory.launchOfficialWhilePaused("ipfs://reviewed-fair-policy");
            require(factory.officialIdentityMigration().consumed(), "fair policy did not consume migration");
        }

        function testOfficialPausedRouteRequiresBothLegacyReservations() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setUsed(true, false);

            vm.prank(OFFICIAL_LAUNCHER);
            (bool success,) = address(factory)
                .call(abi.encodeCall(factory.launchOfficialWhilePaused, ("ipfs://incomplete-legacy-reservation")));

            require(!success, "incomplete legacy identity reservation accepted");
            require(!factory.officialIdentityMigration().consumed(), "incomplete reservation consumed migration");
            require(factory.launchCount() == 0, "incomplete reservation stored a launch");
        }

        function testOrdinaryLaunchesRemainBlockedUntilOfficialMigrationSucceeds() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(false);

            (bool prematureSuccess,) = address(factory)
                .call(abi.encodeCall(factory.launchSimple, ("Premature Launch", "EARLY", "ipfs://premature")));
            require(!prematureSuccess, "ordinary launch opened before official migration");
            require(factory.launchCount() == 0, "premature launch stored");

            _completeOfficialMigration(factory, gate, legacy);
            (address token,,) = factory.launchSimple("Public Launch", "PUBLIC", "ipfs://public");
            require(token != address(0), "ordinary launch unavailable after official migration");
        }

        function testBothLaunchEntrypointsUseTheSharedPauseGate() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            gate.setPaused(true);

            (bool simpleSuccess,) = address(factory)
                .call(abi.encodeCall(factory.launchSimple, ("Paused Simple", "PAUS", "ipfs://paused-simple")));
            (bool policySuccess,) = address(factory)
                .call(abi.encodeCall(factory.launch, (OPEN_POLICY_ID, "Paused Policy", "PAUP", "ipfs://paused-policy")));

            require(!simpleSuccess, "launchSimple bypassed pause");
            require(!policySuccess, "launch bypassed pause");
            require(factory.launchCount() == 1, "paused launch stored");
        }

        function testOrdinaryLaunchDoesNotRecordMigration() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);

            (address token,,) = factory.launchSimple("Ordinary Token", "ORD", "ipfs://ordinary");
            IRMTLaunchFactoryV6.LaunchView memory launchRecord = factory.getLaunch(1);

            require(token != address(0), "ordinary token missing");
            require(!launchRecord.officialMigration, "ordinary launch marked migration");
            require(factory.officialIdentityMigration().consumed(), "official migration was not preserved");
        }

        function testRejectsDuplicateV6CanonicalNameAcrossCaseAndSeparators() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            factory.launchSimple("Alpha Token", "ALPHA", "ipfs://alpha");

            (bool success,) = address(factory)
                .call(abi.encodeCall(factory.launchSimple, ("A.l_p'h-a Token", "BETA", "ipfs://duplicate-name")));

            require(!success, "canonical duplicate name accepted");
            require(factory.isNameUsed("a-l_p.h'a token"), "canonical name lookup missed reservation");
            require(factory.launchCount() == 2, "duplicate name stored");
        }

        function testRejectsDuplicateV6CanonicalSymbolCaseInsensitive() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            factory.launchSimple("Alpha Token", "ALPHA", "ipfs://alpha");

            (bool success,) = address(factory)
                .call(abi.encodeCall(factory.launchSimple, ("Beta Token", "alpha", "ipfs://duplicate-symbol")));

            require(!success, "canonical duplicate symbol accepted");
            require(factory.isSymbolUsed("alpha"), "canonical symbol lookup missed reservation");
            require(factory.launchCount() == 2, "duplicate symbol stored");
        }

        function testRejectsLegacyNameOnlyReservationForOrdinaryIdentity() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            legacy.setNameUsed("Reserved Legacy Name", true);

            (bool success,) = address(factory)
                .call(
                    abi.encodeCall(
                        factory.launchSimple, ("Reserved Legacy Name", "AVAILABLE", "ipfs://legacy-name-only")
                    )
                );

            require(!success, "legacy name-only reservation bypassed");
            require(factory.launchCount() == 1, "legacy name-only launch stored");
        }

        function testRejectsLegacySymbolOnlyReservationForOrdinaryIdentity() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            legacy.setSymbolUsed("LEGACY", true);

            (bool success,) = address(factory)
                .call(abi.encodeCall(factory.launchSimple, ("Available Name", "LEGACY", "ipfs://legacy-symbol-only")));

            require(!success, "legacy symbol-only reservation bypassed");
            require(factory.launchCount() == 1, "legacy symbol-only launch stored");
        }

        function testOfficialExceptionCannotMigrateDifferentLegacyIdentity() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            gate.setPaused(true);
            legacy.setNameUsed("Fake Robinhood Terminal", true);
            legacy.setSymbolUsed("FAKE", true);

            require(
                !factory.canMigrateOfficialIdentity(
                    OFFICIAL_LAUNCHER, FAIR_POLICY_ID, "Fake Robinhood Terminal", "FAKE"
                ),
                "different identity advertised as official"
            );
            require(!factory.officialIdentityMigration().consumed(), "different identity consumed migration");
            require(factory.launchCount() == 0, "different identity stored a launch");
        }

        function testOrdinaryLaunchTransfersFullSupplyToMarketAndNoneToCreator() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);

            (address token, address market,) =
                factory.launchSimple("Full Market Inventory", "FULL", "ipfs://full-inventory");

            require(CloneFixedSupplyMemeToken(token).totalSupply() == factory.TOKEN_SUPPLY(), "wrong fixed supply");
            require(CloneFixedSupplyMemeToken(token).balanceOf(market) == factory.TOKEN_SUPPLY(), "market inventory");
            require(CloneFixedSupplyMemeToken(token).balanceOf(address(this)) == 0, "creator allocation");
            require(CloneFixedSupplyMemeToken(token).balanceOf(address(factory)) == 0, "factory residue");
        }

        function testCurveBuyAndSellRouteOnlyExactSeventyThirtyNativeFees() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);

            (address tokenAddress, address marketAddress, address splitterAddress) =
                factory.launch(OPEN_POLICY_ID, "Exact Fee Split", "EFS", "ipfs://exact-fee-split");
            CloneFixedSupplyMemeToken token = CloneFixedSupplyMemeToken(tokenAddress);
            CloneBondingCurveMarketV6 market = CloneBondingCurveMarketV6(payable(marketAddress));
            DirectLaunchFeeSplitter splitter = DirectLaunchFeeSplitter(payable(splitterAddress));
            address protocolTreasury = splitter.protocolTreasury();

            vm.deal(address(this), 5 ether);
            uint256 creatorBalanceBefore = address(this).balance;
            uint256 treasuryBalanceBefore = protocolTreasury.balance;

            uint256 grossBuy = 1 ether;
            (uint256 tokensOut, uint256 acceptedEth, uint256 buyFee,) = market.quoteBuyExecution(grossBuy);
            require(tokensOut != 0 && acceptedEth == grossBuy, "unexpected buy quote");
            market.buy{value: grossBuy}(address(this), tokensOut, block.timestamp);

            uint256 sellAmount = tokensOut / 2;
            require(token.approve(marketAddress, sellAmount), "sell approval");
            (uint256 ethOut, uint256 sellFee,) = market.quoteSell(sellAmount);
            require(ethOut != 0 && sellFee != 0, "unexpected sell quote");
            market.sell(sellAmount, ethOut, payable(address(this)), block.timestamp);

            uint256 totalFees = buyFee + sellFee;
            uint256 creatorFees = (totalFees * 7_000) / 10_000;
            uint256 protocolFees = totalFees - creatorFees;
            require(splitter.totalReceived() == totalFees, "native fees not fully accounted");
            require(splitter.totalPaid() == totalFees, "native fees not fully paid");
            require(
                address(this).balance == creatorBalanceBefore - acceptedEth + ethOut + creatorFees, "creator not 70%"
            );
            require(protocolTreasury.balance == treasuryBalanceBefore + protocolFees, "protocol not 30%");
            require(splitter.pending(address(this)) == 0, "creator payment unexpectedly deferred");
            require(splitter.pending(protocolTreasury) == 0, "protocol payment unexpectedly deferred");
            require(splitter.totalTokenReceived(tokenAddress) == 0, "curve invented token fees");
            require(token.balanceOf(address(this)) == tokensOut - sellAmount, "creator received a token allocation");
            require(
                token.balanceOf(marketAddress) == factory.TOKEN_SUPPLY() - tokensOut + sellAmount, "market inventory"
            );
        }

        function testCreatorCannotChangePayoutButFactoryConfiguredAuthorityCan() public {
            (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy) = _deploy();
            _completeOfficialMigration(factory, gate, legacy);
            (,, address splitterAddress) =
                factory.launchSimple("Governed Creator Wallet", "GCW", "ipfs://governed-creator");
            DirectLaunchFeeSplitter splitter = DirectLaunchFeeSplitter(payable(splitterAddress));
            address protocolTreasury = splitter.protocolTreasury();
            bytes32 evidenceHash = keccak256("documented-rug-evidence");

            (bool creatorChanged,) = address(splitter)
                .call(abi.encodeCall(splitter.setCreatorWallet, (payable(protocolTreasury), evidenceHash, 0)));
            require(!creatorChanged, "creator changed payout recipient");

            MockV6CreatorPayoutAuthority authority = MockV6CreatorPayoutAuthority(factory.creatorPayoutAuthority());
            authority.setCreator(splitter, payable(protocolTreasury), evidenceHash, 0);
            require(splitter.creator() == protocolTreasury, "authority did not redirect payout");
            require(splitter.originalCreator() == address(this), "historical creator changed");
        }

        function _completeOfficialMigration(
            RMTLaunchFactoryV6 factory,
            MockV6LaunchGate gate,
            MockV6LegacyIdentityFactory legacy
        ) private {
            gate.setPaused(true);
            legacy.setUsed(true, true);
            vm.prank(OFFICIAL_LAUNCHER);
            factory.launchOfficialWhilePaused("ipfs://official-test-prerequisite");
            legacy.setUsed(false, false);
            gate.setPaused(false);
        }

        function deployCandidate(address officialLegacyToken) external returns (address factoryAddress) {
            (RMTLaunchFactoryV6 factory,,) = _deployWithOfficialLegacyToken(officialLegacyToken);
            return address(factory);
        }

        function _candidateDeploySucceeds(address officialLegacyToken) private returns (bool success) {
            (success,) = address(this).call(abi.encodeWithSelector(this.deployCandidate.selector, officialLegacyToken));
        }

        function _bindingCandidateDeploys(RMTLaunchFactoryV6 source) private returns (bool deployed) {
            try new RMTLaunchFactoryV6(
                address(source.launchGate()),
                address(source.policyRegistry()),
                address(source.factoryRegistry()),
                source.initialVirtualEthReserve(),
                source.initialVirtualTokenReserve(),
                source.legacyIdentityFactory(),
                source.officialLegacyToken(),
                OFFICIAL_LAUNCHER
            ) returns (RMTLaunchFactoryV6 candidate) {
                deployed = address(candidate) != address(0);
            } catch {}
        }

        function _deploy()
            private
            returns (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy)
        {
            MockV6OfficialLegacyToken officialLegacyToken =
                new MockV6OfficialLegacyToken("Robinhood Meme Terminal", "RMT", OFFICIAL_LAUNCHER);
            return _deployWithOfficialLegacyToken(address(officialLegacyToken));
        }

        function _deployWithOfficialLegacyToken(address officialLegacyToken)
            private
            returns (RMTLaunchFactoryV6 factory, MockV6LaunchGate gate, MockV6LegacyIdentityFactory legacy)
        {
            MockV6CreatorPayoutAuthority payoutAuthority = new MockV6CreatorPayoutAuthority();
            gate = new MockV6LaunchGate(address(payoutAuthority));
            legacy = new MockV6LegacyIdentityFactory();
            legacy.setUsed(true, true);
            MockV6GraduationAdapter adapter = new MockV6GraduationAdapter();
            CloneBondingCurveMarketV6 marketImplementation = new CloneBondingCurveMarketV6();
            IRMTLaunchPolicyRegistry.LaunchPolicy memory fairPolicy = IRMTLaunchPolicyRegistry.LaunchPolicy({
                policyId: FAIR_POLICY_ID,
                policyVersion: 1,
                enabled: true,
                publiclySelectable: true,
                curveFeeBps: 100,
                creatorFeeShareBps: 7_000,
                protocolFeeShareBps: 3_000,
                postGraduationFeeBps: 50,
                graduationTarget: 2 ether,
                fairStartMode: 1,
                fairStartDelayBlocks: 1,
                fairStartDurationBlocks: 10,
                fairStartMaxTxBps: 100,
                fairStartMaxWalletBps: 300,
                marketImplementation: address(marketImplementation),
                protocolTreasury: address(payoutAuthority),
                graduationAdapter: address(adapter)
            });
            IRMTLaunchPolicyRegistry.LaunchPolicy memory openPolicy = IRMTLaunchPolicyRegistry.LaunchPolicy({
                policyId: OPEN_POLICY_ID,
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
                protocolTreasury: address(payoutAuthority),
                graduationAdapter: address(adapter)
            });
            MockV6PolicyRegistry registry = new MockV6PolicyRegistry(fairPolicy, openPolicy, address(payoutAuthority));
            MockV6FactoryRegistry factoryRegistry = new MockV6FactoryRegistry(
                address(payoutAuthority), address(legacy), keccak256("RMT_FACTORY_V5")
            );
            factory = new RMTLaunchFactoryV6(
                address(gate),
                address(registry),
                address(factoryRegistry),
                0.3 ether,
                1_017_500_000 ether,
                address(legacy),
                officialLegacyToken,
                OFFICIAL_LAUNCHER
            );
            factoryRegistry.setActiveFactory(address(factory), factory.FACTORY_VERSION());
        }
    }
