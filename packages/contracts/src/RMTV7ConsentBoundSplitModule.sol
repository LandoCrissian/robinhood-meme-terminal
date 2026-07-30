// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRMTV7ConsentBoundSplitModule} from "./interfaces/IRMTV7ConsentBoundSplitModule.sol";
import {IRMTV7ModuleRegistry} from "./interfaces/IRMTV7ModuleRegistry.sol";
import {IRMTV7ReleaseRegistry} from "./interfaces/IRMTV7ReleaseRegistry.sol";
import {RMTV7ConsentBoundSplit} from "./RMTV7ConsentBoundSplit.sol";

/// @notice Deploys one immutable split only after every recipient signs the exact share and recovery plan.
contract RMTV7ConsentBoundSplitModule is EIP712, ReentrancyGuard, IRMTV7ConsentBoundSplitModule {
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes32 private constant CONSENT_TYPEHASH = keccak256(
        "SplitConsent(address releaseRegistry,bytes32 releaseId,address creator,address module,bytes32 configurationHash,bytes32 payoutManifestHash,address recipient,uint16 shareBps,address recoveryAddress,uint64 consentDeadline)"
    );

    uint8 public constant MODULE_KIND = 3;
    uint32 public constant MODULE_VERSION = 1;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAXIMUM_RECIPIENTS = 32;
    uint256 public constant MAXIMUM_CONSENT_LIFETIME = 30 days;

    IRMTV7ModuleRegistry public immutable moduleRegistry;
    IRMTV7ReleaseRegistry public immutable releaseRegistry;
    mapping(bytes32 releaseId => address split) public override splitForRelease;

    error InvalidConfiguration();
    error ModuleNotActive();
    error ReleaseIntentMismatch();
    error PayoutManifestMismatch();
    error SplitAlreadyDeployed();
    error InvalidRecipientConsent(address recipient);

    constructor(address moduleRegistry_, address releaseRegistry_) EIP712("RMT V7 Consent Bound Split", "1") {
        if (
            moduleRegistry_ == address(0) || moduleRegistry_.code.length == 0 || releaseRegistry_ == address(0)
                || releaseRegistry_.code.length == 0
        ) revert InvalidConfiguration();
        moduleRegistry = IRMTV7ModuleRegistry(moduleRegistry_);
        releaseRegistry = IRMTV7ReleaseRegistry(releaseRegistry_);
    }

    function hashSplitConfig(SplitConfig calldata config)
        external
        pure
        override
        returns (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash)
    {
        return _hashSplitConfig(config);
    }

    function consentDigest(
        bytes32 releaseId,
        address creator,
        bytes32 configurationHash,
        bytes32 payoutManifestHash,
        address recipient,
        uint16 shareBps,
        address recovery,
        uint64 consentDeadline
    ) public view override returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CONSENT_TYPEHASH,
                    address(releaseRegistry),
                    releaseId,
                    creator,
                    address(this),
                    configurationHash,
                    payoutManifestHash,
                    recipient,
                    shareBps,
                    recovery,
                    consentDeadline
                )
            )
        );
    }

    function deploySplit(bytes32 releaseId, SplitConfig calldata config, bytes[] calldata consentSignatures)
        external
        override
        nonReentrant
        returns (address split)
    {
        if (releaseId == bytes32(0)) revert InvalidConfiguration();
        _validateConfig(config);
        if (splitForRelease[releaseId] != address(0)) revert SplitAlreadyDeployed();
        if (consentSignatures.length != config.recipients.length) revert InvalidConfiguration();

        bytes32 moduleKey = _activeModuleKey();
        (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash) = _hashSplitConfig(config);
        if (!releaseRegistry.isFrozenModuleIntent(releaseId, msg.sender, moduleKey, configurationHash)) {
            revert ReleaseIntentMismatch();
        }
        if (!releaseRegistry.isFrozenPayoutManifest(releaseId, msg.sender, payoutManifestHash)) {
            revert PayoutManifestMismatch();
        }

        for (uint256 i; i < config.recipients.length; ++i) {
            address recipient = config.recipients[i];
            bytes32 digest = consentDigest(
                releaseId,
                msg.sender,
                configurationHash,
                payoutManifestHash,
                recipient,
                config.sharesBps[i],
                config.recoveryAddresses[i],
                config.consentDeadline
            );
            if (!SignatureChecker.isValidSignatureNow(recipient, digest, consentSignatures[i])) {
                revert InvalidRecipientConsent(recipient);
            }
        }

        split = address(
            new RMTV7ConsentBoundSplit{salt: releaseId}(
                releaseId,
                configurationHash,
                payoutManifestHash,
                consentManifestHash,
                msg.sender,
                config.recipients,
                config.sharesBps,
                config.recoveryAddresses,
                config.consentDeadline
            )
        );
        splitForRelease[releaseId] = split;
        emit ConsentBoundSplitDeployed(releaseId, moduleKey, msg.sender, split, configurationHash, payoutManifestHash);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == type(IRMTV7ConsentBoundSplitModule).interfaceId;
    }

    function _activeModuleKey() private view returns (bytes32 moduleKey) {
        bytes32 versionKey = keccak256(abi.encode(MODULE_KIND, MODULE_VERSION));
        moduleKey = moduleRegistry.moduleKeyByKindAndVersion(versionKey);
        if (moduleKey == bytes32(0) || !moduleRegistry.isModuleActive(moduleKey)) revert ModuleNotActive();
        IRMTV7ModuleRegistry.Module memory module = moduleRegistry.getModule(moduleKey);
        if (
            module.implementation != address(this)
                || module.interfaceId != type(IRMTV7ConsentBoundSplitModule).interfaceId
                || module.implementationCodeHash != address(this).codehash
        ) revert ModuleNotActive();
    }

    function _validateConfig(SplitConfig calldata config) private view {
        uint256 count = config.recipients.length;
        if (
            count == 0 || count > MAXIMUM_RECIPIENTS || config.sharesBps.length != count
                || config.recoveryAddresses.length != count || config.consentDeadline <= block.timestamp
                || config.consentDeadline > block.timestamp + MAXIMUM_CONSENT_LIFETIME
        ) revert InvalidConfiguration();

        uint256 totalShares = 0;
        for (uint256 i; i < count; ++i) {
            if (config.recipients[i] == address(0) || config.sharesBps[i] == 0) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (config.recipients[j] == config.recipients[i]) revert InvalidConfiguration();
            }
            totalShares += config.sharesBps[i];
        }
        if (totalShares != BPS_DENOMINATOR) revert InvalidConfiguration();
    }

    function _hashSplitConfig(SplitConfig calldata config)
        private
        pure
        returns (bytes32 configurationHash, bytes32 payoutManifestHash, bytes32 consentManifestHash)
    {
        payoutManifestHash = keccak256(abi.encode(config.recipients, config.sharesBps));
        consentManifestHash = keccak256(
            abi.encode(config.recipients, config.sharesBps, config.recoveryAddresses, config.consentDeadline)
        );
        configurationHash = keccak256(
            abi.encode(payoutManifestHash, consentManifestHash, config.consentDeadline, config.recipients.length)
        );
    }
}
