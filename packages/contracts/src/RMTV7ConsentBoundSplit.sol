// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Immutable pull-payment split whose shares and recovery wallets were signed by every recipient.
/// @dev Standard non-rebasing ERC-20s are supported. No owner, sweep, redirect, fee or upgrade path exists.
contract RMTV7ConsentBoundSplit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAXIMUM_RECIPIENTS = 32;

    bytes32 public immutable releaseId;
    bytes32 public immutable configurationHash;
    bytes32 public immutable payoutManifestHash;
    bytes32 public immutable consentManifestHash;
    address public immutable originalCreator;
    uint64 public immutable consentDeadline;

    address[] private _recipients;
    mapping(address recipient => uint16 shareBps) public sharesBps;
    mapping(address recipient => address recovery) public recoveryAddress;
    mapping(address recipient => uint256 amount) public nativeReleased;
    mapping(address token => mapping(address recipient => uint256 amount)) public tokenReleased;
    uint256 public totalNativeReleased;
    mapping(address token => uint256 amount) public totalTokenReleased;

    error InvalidConfiguration();
    error UnknownRecipient();
    error NothingToRelease();
    error OnlyRecipientOrRecovery();
    error NativeTransferFailed();

    event NativeReceived(address indexed payer, uint256 amount);
    event NativeReleased(address indexed recipient, address indexed destination, uint256 amount, bool recovery);
    event TokenReleased(
        address indexed token, address indexed recipient, address indexed destination, uint256 amount, bool recovery
    );

    constructor(
        bytes32 releaseId_,
        bytes32 configurationHash_,
        bytes32 payoutManifestHash_,
        bytes32 consentManifestHash_,
        address creator_,
        address[] memory recipients_,
        uint16[] memory sharesBps_,
        address[] memory recoveryAddresses_,
        uint64 consentDeadline_
    ) {
        uint256 recipientCount = recipients_.length;
        if (
            releaseId_ == bytes32(0) || configurationHash_ == bytes32(0) || payoutManifestHash_ == bytes32(0)
                || consentManifestHash_ == bytes32(0) || creator_ == address(0) || recipientCount == 0
                || recipientCount > MAXIMUM_RECIPIENTS || sharesBps_.length != recipientCount
                || recoveryAddresses_.length != recipientCount || consentDeadline_ == 0
        ) revert InvalidConfiguration();

        uint256 totalShares = 0;
        for (uint256 i; i < recipientCount; ++i) {
            address recipient = recipients_[i];
            uint16 share = sharesBps_[i];
            if (recipient == address(0) || share == 0 || sharesBps[recipient] != 0) revert InvalidConfiguration();
            sharesBps[recipient] = share;
            recoveryAddress[recipient] = recoveryAddresses_[i];
            _recipients.push(recipient);
            totalShares += share;
        }
        if (totalShares != BPS_DENOMINATOR) revert InvalidConfiguration();

        bytes32 expectedPayoutManifestHash = keccak256(abi.encode(recipients_, sharesBps_));
        bytes32 expectedConsentManifestHash =
            keccak256(abi.encode(recipients_, sharesBps_, recoveryAddresses_, consentDeadline_));
        bytes32 expectedConfigurationHash = keccak256(
            abi.encode(expectedPayoutManifestHash, expectedConsentManifestHash, consentDeadline_, recipientCount)
        );
        if (
            payoutManifestHash_ != expectedPayoutManifestHash || consentManifestHash_ != expectedConsentManifestHash
                || configurationHash_ != expectedConfigurationHash
        ) revert InvalidConfiguration();

        releaseId = releaseId_;
        configurationHash = configurationHash_;
        payoutManifestHash = payoutManifestHash_;
        consentManifestHash = consentManifestHash_;
        originalCreator = creator_;
        consentDeadline = consentDeadline_;
    }

    receive() external payable {
        if (msg.value == 0) revert InvalidConfiguration();
        emit NativeReceived(msg.sender, msg.value);
    }

    function recipients() external view returns (address[] memory) {
        return _recipients;
    }

    function releasableNative(address recipient) public view returns (uint256) {
        uint16 share = _requireRecipient(recipient);
        uint256 totalReceived = address(this).balance + totalNativeReleased;
        uint256 entitled = Math.mulDiv(totalReceived, share, BPS_DENOMINATOR);
        uint256 released = nativeReleased[recipient];
        return entitled > released ? entitled - released : 0;
    }

    function releasableToken(IERC20 token, address recipient) public view returns (uint256) {
        if (address(token).code.length == 0) revert InvalidConfiguration();
        uint16 share = _requireRecipient(recipient);
        uint256 totalReceived = token.balanceOf(address(this)) + totalTokenReleased[address(token)];
        uint256 entitled = Math.mulDiv(totalReceived, share, BPS_DENOMINATOR);
        uint256 released = tokenReleased[address(token)][recipient];
        return entitled > released ? entitled - released : 0;
    }

    function releaseNative(address recipient) external nonReentrant {
        _releaseNative(recipient, payable(recipient), false);
    }

    function releaseNativeToRecovery(address recipient) external nonReentrant {
        address recovery = _authorizedRecovery(recipient);
        _releaseNative(recipient, payable(recovery), true);
    }

    function releaseToken(IERC20 token, address recipient) external nonReentrant {
        _releaseToken(token, recipient, recipient, false);
    }

    function releaseTokenToRecovery(IERC20 token, address recipient) external nonReentrant {
        address recovery = _authorizedRecovery(recipient);
        _releaseToken(token, recipient, recovery, true);
    }

    function _releaseNative(address recipient, address payable destination, bool recovery) private {
        uint256 amount = releasableNative(recipient);
        if (amount == 0) revert NothingToRelease();
        nativeReleased[recipient] += amount;
        totalNativeReleased += amount;
        // Destination is restricted to the immutable recipient or that recipient's signed recovery wallet.
        // slither-disable-next-line arbitrary-send-eth
        (bool success,) = destination.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit NativeReleased(recipient, destination, amount, recovery);
    }

    function _releaseToken(IERC20 token, address recipient, address destination, bool recovery) private {
        uint256 amount = releasableToken(token, recipient);
        if (amount == 0) revert NothingToRelease();
        tokenReleased[address(token)][recipient] += amount;
        totalTokenReleased[address(token)] += amount;
        token.safeTransfer(destination, amount);
        emit TokenReleased(address(token), recipient, destination, amount, recovery);
    }

    function _authorizedRecovery(address recipient) private view returns (address recovery) {
        _requireRecipient(recipient);
        recovery = recoveryAddress[recipient];
        if (recovery == address(0) || (msg.sender != recipient && msg.sender != recovery)) {
            revert OnlyRecipientOrRecovery();
        }
    }

    function _requireRecipient(address recipient) private view returns (uint16 share) {
        share = sharesBps[recipient];
        if (share == 0) revert UnknownRecipient();
    }
}
