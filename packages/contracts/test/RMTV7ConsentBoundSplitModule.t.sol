// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IRMTV7ConsentBoundSplitModule} from "../src/interfaces/IRMTV7ConsentBoundSplitModule.sol";
import {IRMTV7MediaEvidenceVerifier} from "../src/interfaces/IRMTV7MediaEvidenceVerifier.sol";
import {RMTV7ConsentBoundSplit} from "../src/RMTV7ConsentBoundSplit.sol";
import {RMTV7ConsentBoundSplitModule} from "../src/RMTV7ConsentBoundSplitModule.sol";
import {RMTV7MediaEvidenceVerifier} from "../src/RMTV7MediaEvidenceVerifier.sol";
import {RMTV7ModuleRegistry} from "../src/RMTV7ModuleRegistry.sol";
import {RMTV7ReleaseRegistry} from "../src/RMTV7ReleaseRegistry.sol";

interface V7SplitVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract V7SplitGovernance {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory output) = target.call(data);
        require(success, "governance call failed");
        return output;
    }
}

contract V7SplitToken is ERC20 {
    constructor() ERC20("Split Test Token", "SPLIT") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract V7SplitERC1271Recipient is IERC1271 {
    address private immutable _signer;

    constructor(address signer_) {
        _signer = signer_;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == _signer ? IERC1271.isValidSignature.selector : bytes4(0);
    }
}

contract RMTV7ConsentBoundSplitModuleTest {
    V7SplitVm private constant vm = V7SplitVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant EVIDENCE_SIGNER_KEY = 0xA11CE;
    uint256 private constant RECIPIENT_ONE_KEY = 0xB0B;
    uint256 private constant RECIPIENT_TWO_KEY = 0xCAFE;
    uint256 private constant ERC1271_SIGNER_KEY = 0xD00D;
    address private constant RECOVERY_ONE = address(0x1111);
    address private constant RECOVERY_TWO = address(0x2222);
    address private constant UNAUTHORIZED = address(0xBAD);

    V7SplitGovernance private governance;
    RMTV7ModuleRegistry private moduleRegistry;
    RMTV7MediaEvidenceVerifier private mediaEvidenceVerifier;
    RMTV7ReleaseRegistry private releaseRegistry;
    RMTV7ConsentBoundSplitModule private splitModule;
    bytes32 private moduleKey;

    function setUp() public {
        governance = new V7SplitGovernance();
        moduleRegistry = new RMTV7ModuleRegistry(address(governance));
        mediaEvidenceVerifier = new RMTV7MediaEvidenceVerifier(address(governance), vm.addr(EVIDENCE_SIGNER_KEY));
        releaseRegistry = new RMTV7ReleaseRegistry(address(moduleRegistry), address(mediaEvidenceVerifier));
        splitModule = new RMTV7ConsentBoundSplitModule(address(moduleRegistry), address(releaseRegistry));
        moduleKey = _registerSplitModule();
    }

    function testEveryRecipientConsentDeploysOneExactImmutableSplit() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        bytes32 releaseId = _freezeSplitRelease(config, bytes32(0));
        uint256[] memory signerKeys = _defaultSignerKeys();
        bytes[] memory signatures = _signConsents(releaseId, config, signerKeys);

        address splitAddress = splitModule.deploySplit(releaseId, config, signatures);
        RMTV7ConsentBoundSplit split = RMTV7ConsentBoundSplit(payable(splitAddress));
        (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash) =
            splitModule.hashSplitConfig(config);

        require(splitModule.splitForRelease(releaseId) == splitAddress, "split not recorded");
        require(split.releaseId() == releaseId, "release not bound");
        require(split.originalCreator() == address(this), "creator not bound");
        require(split.configurationHash() == configurationHash, "configuration not bound");
        require(split.payoutManifestHash() == payoutManifestHash, "payout not bound");
        require(split.consentManifestHash() == consentManifestHash, "consent not bound");
        require(split.consentDeadline() == config.consentDeadline, "deadline not bound");
        require(split.sharesBps(config.recipients[0]) == 7_000, "first share changed");
        require(split.sharesBps(config.recipients[1]) == 3_000, "second share changed");
        require(split.recoveryAddress(config.recipients[0]) == RECOVERY_ONE, "first recovery changed");
        require(split.recoveryAddress(config.recipients[1]) == RECOVERY_TWO, "second recovery changed");

        address[] memory recipients = split.recipients();
        require(recipients.length == 2, "recipient count changed");
        require(recipients[0] == config.recipients[0] && recipients[1] == config.recipients[1], "order changed");

        (bool duplicateDeployed,) =
            address(splitModule).call(abi.encodeCall(splitModule.deploySplit, (releaseId, config, signatures)));
        require(!duplicateDeployed, "duplicate split deployed");
    }

    function testNativeRevenueIsPullBasedAndUsesLifetimeAccounting() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        RMTV7ConsentBoundSplit split = _deploy(config, _defaultSignerKeys());
        vm.deal(address(this), 20 ether);
        (bool funded,) = address(split).call{value: 10 ether}("");
        require(funded, "native funding failed");
        require(split.releasableNative(config.recipients[0]) == 7 ether, "first amount wrong");
        require(split.releasableNative(config.recipients[1]) == 3 ether, "second amount wrong");

        uint256 firstBefore = config.recipients[0].balance;
        split.releaseNative(config.recipients[0]);
        require(config.recipients[0].balance - firstBefore == 7 ether, "first payout wrong");
        require(split.totalNativeReleased() == 7 ether, "released total wrong");

        (funded,) = address(split).call{value: 10 ether}("");
        require(funded, "second funding failed");
        require(split.releasableNative(config.recipients[0]) == 7 ether, "lifetime first amount wrong");
        require(split.releasableNative(config.recipients[1]) == 6 ether, "lifetime second amount wrong");

        uint256 secondBefore = config.recipients[1].balance;
        split.releaseNative(config.recipients[1]);
        require(config.recipients[1].balance - secondBefore == 6 ether, "second payout wrong");
        require(address(split).balance == 7 ether, "unexpected split balance");
    }

    function testRejectedNativePayoutPreservesAccountingAndSignedRecoveryWorks() public {
        V7SplitERC1271Recipient contractRecipient = new V7SplitERC1271Recipient(vm.addr(ERC1271_SIGNER_KEY));
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        config.recipients[0] = address(contractRecipient);
        uint256[] memory signerKeys = new uint256[](2);
        signerKeys[0] = ERC1271_SIGNER_KEY;
        signerKeys[1] = RECIPIENT_TWO_KEY;
        RMTV7ConsentBoundSplit split = _deploy(config, signerKeys);
        vm.deal(address(this), 10 ether);
        (bool funded,) = address(split).call{value: 10 ether}("");
        require(funded, "funding failed");

        (bool rejected,) = address(split).call(abi.encodeCall(split.releaseNative, (address(contractRecipient))));
        require(!rejected, "rejecting recipient received native");
        require(split.nativeReleased(address(contractRecipient)) == 0, "failed payout changed recipient accounting");
        require(split.totalNativeReleased() == 0, "failed payout changed total accounting");
        require(address(split).balance == 10 ether, "failed payout lost funds");

        vm.prank(UNAUTHORIZED);
        (bool unauthorized,) =
            address(split).call(abi.encodeCall(split.releaseNativeToRecovery, (address(contractRecipient))));
        require(!unauthorized, "unauthorized recovery succeeded");

        uint256 recoveryBefore = RECOVERY_ONE.balance;
        vm.prank(RECOVERY_ONE);
        split.releaseNativeToRecovery(address(contractRecipient));
        require(RECOVERY_ONE.balance - recoveryBefore == 7 ether, "recovery payout wrong");
        require(split.nativeReleased(address(contractRecipient)) == 7 ether, "recovery accounting wrong");
    }

    function testERC20RevenueUsesTheSameSignedSharesAndRecoveryRules() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        RMTV7ConsentBoundSplit split = _deploy(config, _defaultSignerKeys());
        V7SplitToken token = new V7SplitToken();
        token.mint(address(split), 1_000 ether);

        require(split.releasableToken(token, config.recipients[0]) == 700 ether, "first token amount wrong");
        split.releaseToken(token, config.recipients[0]);
        require(token.balanceOf(config.recipients[0]) == 700 ether, "first token payout wrong");

        vm.prank(config.recipients[1]);
        split.releaseTokenToRecovery(token, config.recipients[1]);
        require(token.balanceOf(RECOVERY_TWO) == 300 ether, "token recovery payout wrong");
        require(split.totalTokenReleased(address(token)) == 1_000 ether, "token total wrong");

        (bool emptyRelease,) = address(split).call(abi.encodeCall(split.releaseToken, (token, config.recipients[0])));
        require(!emptyRelease, "zero token release succeeded");
    }

    function testWrongExpiredAndCrossReleaseSignaturesCannotDeploy() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        bytes32 firstReleaseId = _freezeSplitRelease(config, bytes32(0));
        bytes[] memory firstSignatures = _signConsents(firstReleaseId, config, _defaultSignerKeys());

        bytes32 secondReleaseId = _freezeSplitRelease(config, bytes32(0));
        (bool replayed,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (secondReleaseId, config, firstSignatures)));
        require(!replayed, "consent replayed across release");

        bytes[] memory wrongSignatures = _signConsents(firstReleaseId, config, _defaultSignerKeys());
        (uint8 wrongV, bytes32 wrongR, bytes32 wrongS) = vm.sign(
            0xDEAD,
            splitModule.consentDigest(
                firstReleaseId,
                address(this),
                _configurationHash(config),
                _payoutManifestHash(config),
                config.recipients[0],
                config.sharesBps[0],
                config.recoveryAddresses[0],
                config.consentDeadline
            )
        );
        wrongSignatures[0] = abi.encodePacked(wrongR, wrongS, wrongV);
        (bool wrongSignerDeployed,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (firstReleaseId, config, wrongSignatures)));
        require(!wrongSignerDeployed, "wrong signer deployed split");

        vm.warp(uint256(config.consentDeadline) + 1);
        (bool expiredDeployed,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (firstReleaseId, config, firstSignatures)));
        require(!expiredDeployed, "expired consent deployed split");
    }

    function testFrozenPayoutManifestAndCreatorMustMatch() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        bytes32 releaseId = _freezeSplitRelease(config, keccak256("WRONG_PAYOUT_MANIFEST"));
        bytes[] memory signatures = _signConsents(releaseId, config, _defaultSignerKeys());
        (bool wrongPayoutDeployed,) =
            address(splitModule).call(abi.encodeCall(splitModule.deploySplit, (releaseId, config, signatures)));
        require(!wrongPayoutDeployed, "mismatched payout manifest deployed");

        IRMTV7ConsentBoundSplitModule.SplitConfig memory validConfig = _config();
        bytes32 validReleaseId = _freezeSplitRelease(validConfig, bytes32(0));
        bytes[] memory validSignatures = _signConsents(validReleaseId, validConfig, _defaultSignerKeys());
        vm.prank(UNAUTHORIZED);
        (bool wrongCreatorDeployed,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (validReleaseId, validConfig, validSignatures)));
        require(!wrongCreatorDeployed, "wrong creator deployed split");
    }

    function testInvalidConfigurationAndInactiveModuleBlockDeployment() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory invalid = _config();
        invalid.sharesBps[0] = 6_999;
        bytes[] memory signatures = new bytes[](2);
        (bool badTotal,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (keccak256("release"), invalid, signatures)));
        require(!badTotal, "invalid share total accepted");

        invalid = _config();
        invalid.recipients[1] = invalid.recipients[0];
        (bool duplicate,) = address(splitModule)
            .call(abi.encodeCall(splitModule.deploySplit, (keccak256("release"), invalid, signatures)));
        require(!duplicate, "duplicate recipient accepted");

        IRMTV7ConsentBoundSplitModule.SplitConfig memory valid = _config();
        bytes32 releaseId = _freezeSplitRelease(valid, bytes32(0));
        bytes[] memory validSignatures = _signConsents(releaseId, valid, _defaultSignerKeys());
        governance.execute(address(moduleRegistry), abi.encodeCall(moduleRegistry.deactivateModule, (moduleKey)));
        (bool inactiveDeployed,) =
            address(splitModule).call(abi.encodeCall(splitModule.deploySplit, (releaseId, valid, validSignatures)));
        require(!inactiveDeployed, "inactive module deployed split");
    }

    function testDirectDeploymentCannotLieAboutManifestHashes() public {
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = _config();
        (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash) =
            splitModule.hashSplitConfig(config);
        bool reverted;
        try new RMTV7ConsentBoundSplit(
            keccak256("release"),
            configurationHash,
            keccak256("dishonest payout"),
            consentManifestHash,
            address(this),
            config.recipients,
            config.sharesBps,
            config.recoveryAddresses,
            config.consentDeadline
        ) returns (
            RMTV7ConsentBoundSplit
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "dishonest payout hash accepted");
        require(payoutManifestHash != keccak256("dishonest payout"), "test vector invalid");
    }

    function testModuleRejectsNativeCustodyAndAdvertisesReviewedInterface() public {
        vm.deal(address(this), 1 wei);
        (bool received,) = address(splitModule).call{value: 1 wei}("");
        require(!received && address(splitModule).balance == 0, "module retained native asset");
        require(splitModule.supportsInterface(0x01ffc9a7), "ERC165 missing");
        require(
            splitModule.supportsInterface(type(IRMTV7ConsentBoundSplitModule).interfaceId), "split interface missing"
        );
        require(!splitModule.supportsInterface(0xffffffff), "invalid interface advertised");
    }

    function testConfigurationMatchesPublicWebEncodingVector() public view {
        address[] memory recipients = new address[](2);
        recipients[0] = address(0x5555555555555555555555555555555555555555);
        recipients[1] = address(0x6666666666666666666666666666666666666666);
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7_000;
        shares[1] = 3_000;
        address[] memory recoveries = new address[](2);
        recoveries[0] = address(0x7777777777777777777777777777777777777777);
        recoveries[1] = address(0x8888888888888888888888888888888888888888);
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config = IRMTV7ConsentBoundSplitModule.SplitConfig({
            recipients: recipients, sharesBps: shares, recoveryAddresses: recoveries, consentDeadline: 1_785_456_000
        });
        (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash) =
            splitModule.hashSplitConfig(config);
        require(
            configurationHash == 0xd8401496f691bca6786ed4020323865df39c19f2c5c49d0ffc166c13185aa974,
            "configuration vector changed"
        );
        require(
            payoutManifestHash == 0x5e6736b4665d23c589749ad769d9a9c282c1676fb04632e224521439abda5c11,
            "payout vector changed"
        );
        require(
            consentManifestHash == 0x602ac0f1f76e7cc900271376ce8eaf3db40c41ef36ed44946ad9e7852797139f,
            "consent vector changed"
        );
    }

    function _deploy(IRMTV7ConsentBoundSplitModule.SplitConfig memory config, uint256[] memory signerKeys)
        private
        returns (RMTV7ConsentBoundSplit split)
    {
        bytes32 releaseId = _freezeSplitRelease(config, bytes32(0));
        bytes[] memory signatures = _signConsents(releaseId, config, signerKeys);
        split = RMTV7ConsentBoundSplit(payable(splitModule.deploySplit(releaseId, config, signatures)));
    }

    function _registerSplitModule() private returns (bytes32 registeredModuleKey) {
        bytes memory output = governance.execute(
            address(moduleRegistry),
            abi.encodeCall(
                moduleRegistry.registerModule,
                (
                    splitModule.MODULE_KIND(),
                    splitModule.MODULE_VERSION(),
                    address(splitModule),
                    type(IRMTV7ConsentBoundSplitModule).interfaceId,
                    keccak256("RMT_CONSENT_BOUND_SPLIT_POLICY_V1"),
                    keccak256("RMT_CONSENT_BOUND_SPLIT_MODULE_METADATA_V1")
                )
            )
        );
        registeredModuleKey = abi.decode(output, (bytes32));
    }

    function _freezeSplitRelease(IRMTV7ConsentBoundSplitModule.SplitConfig memory config, bytes32 payoutOverride)
        private
        returns (bytes32 releaseId)
    {
        (bytes32 configurationHash, bytes32 payoutManifestHash,) = splitModule.hashSplitConfig(config);
        bytes32 committedPayout = payoutOverride == bytes32(0) ? payoutManifestHash : payoutOverride;
        releaseId = releaseRegistry.commitRelease(
            keccak256("PROJECT"),
            keccak256("ASSET"),
            keccak256("RIGHTS_REVISION"),
            keccak256("METADATA"),
            keccak256("MEDIA_MANIFEST"),
            keccak256("FEE_POLICY"),
            committedPayout
        );
        RMTV7ReleaseRegistry.ModuleIntent[] memory intents = new RMTV7ReleaseRegistry.ModuleIntent[](1);
        intents[0] = RMTV7ReleaseRegistry.ModuleIntent(moduleKey, configurationHash);
        IRMTV7MediaEvidenceVerifier.MediaEvidence memory evidence = IRMTV7MediaEvidenceVerifier.MediaEvidence({
            receiptHash: keccak256("VERIFIED_MEDIA_RECEIPT"),
            availabilityObservationHash: keccak256("HEALTHY_AVAILABILITY_OBSERVATION"),
            observedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            signerEpoch: mediaEvidenceVerifier.signerEpoch()
        });
        RMTV7ReleaseRegistry.ReleaseCommitment memory release = releaseRegistry.getRelease(releaseId);
        bytes32 evidenceDigest = mediaEvidenceVerifier.evidenceDigest(
            address(releaseRegistry),
            releaseId,
            release.creator,
            release.metadataHash,
            release.mediaManifestHash,
            evidence
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EVIDENCE_SIGNER_KEY, evidenceDigest);
        releaseRegistry.freezeRelease(releaseId, intents, evidence, abi.encodePacked(r, s, v));
    }

    function _signConsents(
        bytes32 releaseId,
        IRMTV7ConsentBoundSplitModule.SplitConfig memory config,
        uint256[] memory signerKeys
    ) private returns (bytes[] memory signatures) {
        require(signerKeys.length == config.recipients.length, "signer key count wrong");
        (bytes32 configurationHash, bytes32 payoutManifestHash,) = splitModule.hashSplitConfig(config);
        signatures = new bytes[](config.recipients.length);
        for (uint256 i; i < config.recipients.length; ++i) {
            bytes32 digest = splitModule.consentDigest(
                releaseId,
                address(this),
                configurationHash,
                payoutManifestHash,
                config.recipients[i],
                config.sharesBps[i],
                config.recoveryAddresses[i],
                config.consentDeadline
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKeys[i], digest);
            signatures[i] = abi.encodePacked(r, s, v);
        }
    }

    function _config() private returns (IRMTV7ConsentBoundSplitModule.SplitConfig memory config) {
        address[] memory recipients = new address[](2);
        recipients[0] = vm.addr(RECIPIENT_ONE_KEY);
        recipients[1] = vm.addr(RECIPIENT_TWO_KEY);
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7_000;
        shares[1] = 3_000;
        address[] memory recoveries = new address[](2);
        recoveries[0] = RECOVERY_ONE;
        recoveries[1] = RECOVERY_TWO;
        config = IRMTV7ConsentBoundSplitModule.SplitConfig({
            recipients: recipients,
            sharesBps: shares,
            recoveryAddresses: recoveries,
            consentDeadline: uint64(block.timestamp + 1 days)
        });
    }

    function _defaultSignerKeys() private pure returns (uint256[] memory keys) {
        keys = new uint256[](2);
        keys[0] = RECIPIENT_ONE_KEY;
        keys[1] = RECIPIENT_TWO_KEY;
    }

    function _configurationHash(IRMTV7ConsentBoundSplitModule.SplitConfig memory config)
        private
        view
        returns (bytes32 configurationHash)
    {
        (configurationHash,,) = splitModule.hashSplitConfig(config);
    }

    function _payoutManifestHash(IRMTV7ConsentBoundSplitModule.SplitConfig memory config)
        private
        view
        returns (bytes32 payoutManifestHash)
    {
        (, payoutManifestHash,) = splitModule.hashSplitConfig(config);
    }
}
