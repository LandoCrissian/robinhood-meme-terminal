// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pull-based escrow for fees earned by the original permanently locked v4 position.
/// @dev The graduation engine is the sole accounting authority and cannot redirect committed payouts.
contract RMTLaunchCurveLpFeeLedgerV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Policy {
        address creator;
        address treasury;
        uint16 treasuryShareBps;
        address operatingRecipient;
        address futureReserveRecipient;
    }

    struct Amounts {
        uint256 nativeAmount;
        uint256 tokenAmount;
    }

    uint256 public constant PLATFORM_SHARE_BPS = 1_000;
    uint256 private constant PROJECT_SHARE_BPS = 9_000;
    uint256 private constant BPS = 10_000;

    address public immutable engine;
    address public immutable poolManager;
    IERC20 public immutable token;
    address public immutable creator;
    address public immutable treasury;
    uint16 public immutable treasuryShareBps;
    address public immutable operatingRecipient;
    address public immutable futureReserveRecipient;

    Amounts public totalAccrued;
    Amounts public totalClaimed;
    Amounts[4] public bucketAccrued;
    mapping(address recipient => Amounts amounts) public claimable;

    error Unauthorized();
    error InvalidPolicy();
    error InsufficientFeeAssets();
    error NothingToClaim();
    error NativeTransferFailed();

    event LpFeesClaimed(address indexed recipient, uint256 nativeAmount, uint256 tokenAmount);

    constructor(IERC20 token_, address poolManager_, Policy memory policy) {
        if (
            address(token_).code.length == 0 || poolManager_.code.length == 0 || policy.creator == address(0)
                || policy.operatingRecipient == address(0) || policy.futureReserveRecipient == address(0)
                || policy.operatingRecipient == policy.futureReserveRecipient || policy.treasury == policy.creator
                || policy.treasuryShareBps > PROJECT_SHARE_BPS
                || (policy.treasury == address(0)) != (policy.treasuryShareBps == 0)
        ) revert InvalidPolicy();
        engine = msg.sender;
        poolManager = poolManager_;
        token = token_;
        creator = policy.creator;
        treasury = policy.treasury;
        treasuryShareBps = policy.treasuryShareBps;
        operatingRecipient = policy.operatingRecipient;
        futureReserveRecipient = policy.futureReserveRecipient;
    }

    receive() external payable {
        if (msg.sender != poolManager) revert Unauthorized();
    }

    /// @dev Credits exactly the verified pool payout. Unsolicited balances are never claimable.
    function record(uint256 nativeAmount, uint256 tokenAmount) external nonReentrant {
        if (msg.sender != engine) revert Unauthorized();
        Amounts memory accrued =
            Amounts(totalAccrued.nativeAmount + nativeAmount, totalAccrued.tokenAmount + tokenAmount);
        Amounts memory claimed = totalClaimed;
        if (
            address(this).balance < accrued.nativeAmount - claimed.nativeAmount
                || token.balanceOf(address(this)) < accrued.tokenAmount - claimed.tokenAmount
        ) revert InsufficientFeeAssets();
        totalAccrued = accrued;

        uint256[4] memory nativeBuckets = _split(accrued.nativeAmount);
        uint256[4] memory tokenBuckets = _split(accrued.tokenAmount);
        _credit(0, creator, nativeBuckets[0], tokenBuckets[0]);
        _credit(1, treasury, nativeBuckets[1], tokenBuckets[1]);
        _credit(2, operatingRecipient, nativeBuckets[2], tokenBuckets[2]);
        _credit(3, futureReserveRecipient, nativeBuckets[3], tokenBuckets[3]);
    }

    function claim() external nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount) {
        return _claim(true, true);
    }

    /// @notice Claims just one currency to the same immutable beneficiary.
    function claimAsset(bool native) external nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount) {
        return _claim(native, !native);
    }

    function _claim(bool native, bool erc20) private returns (uint256 nativeAmount, uint256 tokenAmount) {
        Amounts storage credit = claimable[msg.sender];
        Amounts memory amount = Amounts(native ? credit.nativeAmount : 0, erc20 ? credit.tokenAmount : 0);
        if (amount.nativeAmount == 0 && amount.tokenAmount == 0) revert NothingToClaim();
        credit.nativeAmount -= amount.nativeAmount;
        credit.tokenAmount -= amount.tokenAmount;
        totalClaimed.nativeAmount += amount.nativeAmount;
        totalClaimed.tokenAmount += amount.tokenAmount;

        if (amount.tokenAmount != 0) token.safeTransfer(msg.sender, amount.tokenAmount);
        if (amount.nativeAmount != 0) {
            (bool sent,) = payable(msg.sender).call{value: amount.nativeAmount}("");
            if (!sent) revert NativeTransferFailed();
        }
        emit LpFeesClaimed(msg.sender, amount.nativeAmount, amount.tokenAmount);
        return (amount.nativeAmount, amount.tokenAmount);
    }

    function _split(uint256 accrued) private view returns (uint256[4] memory shares) {
        uint256 platform = Math.mulDiv(accrued, PLATFORM_SHARE_BPS, BPS);
        uint256 project = accrued - platform;
        shares[1] = Math.mulDiv(project, treasuryShareBps, PROJECT_SHARE_BPS);
        shares[0] = project - shares[1];
        shares[2] = platform / 2;
        shares[3] = platform - shares[2];
    }

    function _credit(uint256 bucket, address recipient, uint256 nativeTotal, uint256 tokenTotal) private {
        Amounts memory previous = bucketAccrued[bucket];
        uint256 nativeIncrement = nativeTotal - previous.nativeAmount;
        uint256 tokenIncrement = tokenTotal - previous.tokenAmount;
        if (nativeIncrement != 0 || tokenIncrement != 0) {
            bucketAccrued[bucket] = Amounts(nativeTotal, tokenTotal);
            claimable[recipient].nativeAmount += nativeIncrement;
            claimable[recipient].tokenAmount += tokenIncrement;
        }
    }
}
