// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable per-launch commitments and pull payments for already collected LP fees.
/// @dev The inheriting factory verifies the actual fee-only balance deltas before crediting this ledger.
abstract contract RMTV4LongevityLedger is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant FEE_RELEASE_CHAIN_ID = 31_337;
    uint256 private constant BPS = 10_000;

    struct FeePolicy {
        address treasury;
        address reserve;
        uint16 creatorBps;
        uint16 treasuryBps;
        uint16 reserveBps;
    }

    struct FeeCommitment {
        address creator;
        address treasury;
        address reserve;
        uint16 creatorBps;
        uint16 treasuryBps;
        uint16 reserveBps;
    }

    struct Fees {
        uint256 nativeAmount;
        uint256 tokenAmount;
    }

    mapping(address token => FeeCommitment commitment) public feePolicy;
    mapping(address token => Fees fees) private accruedFees;
    mapping(address token => mapping(uint8 bucket => Fees fees)) private distributedFees;

    event LongevityPolicyCommitted(
        address indexed token,
        address indexed creator,
        address treasury,
        address reserve,
        uint16 creatorBps,
        uint16 treasuryBps,
        uint16 reserveBps
    );
    event LongevityFeesAccrued(address indexed token, uint256 nativeAmount, uint256 tokenAmount);
    event LongevityFeesWithdrawn(
        address indexed token,
        uint8 indexed bucket,
        address indexed recipient,
        uint256 nativeAmount,
        uint256 tokenAmount
    );

    error InvalidFeePolicy();
    error FeePolicyAlreadyCommitted();
    error FeePolicyUnavailable();
    error InvalidFeeBucket();
    error FeeReleaseChainUnavailable();
    error UnauthorizedFeeRecipient();
    error NoClaimableFees();
    error NativeFeeTransferFailed();

    function _commitFeePolicy(address token, address creator, FeePolicy memory policy) internal {
        if (feePolicy[token].creator != address(0)) revert FeePolicyAlreadyCommitted();
        if (
            token == address(0) || creator == address(0) || creator == address(this) || creator == token
                || uint256(policy.creatorBps) + policy.treasuryBps + policy.reserveBps != BPS
                || !_validOptionalRecipient(policy.treasury, policy.treasuryBps, creator, token)
                || !_validOptionalRecipient(policy.reserve, policy.reserveBps, creator, token)
                || (policy.treasury != address(0) && policy.treasury == policy.reserve)
        ) revert InvalidFeePolicy();

        feePolicy[token] = FeeCommitment(
            creator, policy.treasury, policy.reserve, policy.creatorBps, policy.treasuryBps, policy.reserveBps
        );
        emit LongevityPolicyCommitted(
            token, creator, policy.treasury, policy.reserve, policy.creatorBps, policy.treasuryBps, policy.reserveBps
        );
    }

    function _validOptionalRecipient(address recipient, uint16 share, address creator, address token)
        private
        view
        returns (bool)
    {
        if (share == 0) return recipient == address(0);
        return recipient != address(0) && recipient != creator && recipient != token && recipient != address(this);
    }

    function _accrueFees(address token, uint256 amountNative, uint256 amountToken) internal {
        if (feePolicy[token].creator == address(0)) revert FeePolicyUnavailable();
        if (amountNative == 0 && amountToken == 0) return;
        Fees storage total = accruedFees[token];
        total.nativeAmount += amountNative;
        total.tokenAmount += amountToken;
        emit LongevityFeesAccrued(token, amountNative, amountToken);
    }

    /// @notice Returns lifetime collections and amounts not yet assigned by cumulative rounding.
    /// @dev At most two atomic units per asset are unassigned, regardless of how often fees are collected.
    function feeTotals(address token)
        external
        view
        returns (uint256 nativeAccrued, uint256 tokenAccrued, uint256 nativeRoundingDust, uint256 tokenRoundingDust)
    {
        Fees storage total = accruedFees[token];
        FeeCommitment storage policy = feePolicy[token];
        nativeAccrued = total.nativeAmount;
        tokenAccrued = total.tokenAmount;
        nativeRoundingDust = _roundingDust(nativeAccrued, policy);
        tokenRoundingDust = _roundingDust(tokenAccrued, policy);
    }

    /// @notice Returns the immutable recipient and current and lifetime amounts for a fee bucket.
    /// @param bucket 0 for creator, 1 for project treasury, 2 for liquidity reserve.
    function feeBucket(address token, uint8 bucket)
        public
        view
        returns (
            address recipient,
            uint256 nativeClaimable,
            uint256 tokenClaimable,
            uint256 nativeDistributed,
            uint256 tokenDistributed
        )
    {
        uint16 share;
        (recipient, share) = _feeRole(feePolicy[token], bucket);
        Fees storage total = accruedFees[token];
        Fees storage distributed = distributedFees[token][bucket];
        nativeDistributed = distributed.nativeAmount;
        tokenDistributed = distributed.tokenAmount;
        nativeClaimable = _entitlement(total.nativeAmount, share) - nativeDistributed;
        tokenClaimable = _entitlement(total.tokenAmount, share) - tokenDistributed;
    }

    /// @notice Withdraws the selected bucket to its fixed recipient, who must send the transaction.
    function withdrawFees(address token, uint8 bucket) external nonReentrant {
        if (block.chainid != FEE_RELEASE_CHAIN_ID) revert FeeReleaseChainUnavailable();
        (
            address recipient,
            uint256 nativeClaimable,
            uint256 tokenClaimable,
            uint256 nativeDistributed,
            uint256 tokenDistributed
        ) = feeBucket(token, bucket);
        if (msg.sender != recipient) revert UnauthorizedFeeRecipient();
        if (nativeClaimable == 0 && tokenClaimable == 0) revert NoClaimableFees();

        distributedFees[token][bucket] = Fees(nativeDistributed + nativeClaimable, tokenDistributed + tokenClaimable);
        if (tokenClaimable != 0) IERC20(token).safeTransfer(recipient, tokenClaimable);
        if (nativeClaimable != 0) {
            (bool sent,) = recipient.call{value: nativeClaimable}("");
            if (!sent) revert NativeFeeTransferFailed();
        }
        emit LongevityFeesWithdrawn(token, bucket, recipient, nativeClaimable, tokenClaimable);
    }

    function _feeRole(FeeCommitment storage policy, uint8 bucket) private view returns (address, uint16) {
        if (bucket == 0) return (policy.creator, policy.creatorBps);
        if (bucket == 1) return (policy.treasury, policy.treasuryBps);
        if (bucket == 2) return (policy.reserve, policy.reserveBps);
        revert InvalidFeeBucket();
    }

    function _roundingDust(uint256 amount, FeeCommitment storage policy) private view returns (uint256) {
        return amount - _entitlement(amount, policy.creatorBps) - _entitlement(amount, policy.treasuryBps)
            - _entitlement(amount, policy.reserveBps);
    }

    function _entitlement(uint256 amount, uint16 share) private pure returns (uint256) {
        return Math.mulDiv(amount, share, BPS);
    }
}
