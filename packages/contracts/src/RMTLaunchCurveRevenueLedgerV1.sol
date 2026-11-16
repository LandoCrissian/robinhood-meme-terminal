// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Per-launch ETH fee escrow. It has no access to backing reserves.
contract RMTLaunchCurveRevenueLedgerV1 is ReentrancyGuard {
    uint256 private constant BPS = 10_000;
    uint256 private constant PLATFORM_BPS = 1_000;

    address public immutable curve;
    address public activeCurve;
    address public immutable creator;
    address public immutable treasury;
    address public immutable operatingRecipient;
    address public immutable futureReserveRecipient;
    uint16 public immutable treasuryShareBps;

    uint256 public totalAccrued;
    uint256 public totalClaimed;
    // Creator, treasury, operating revenue, future RMT reserve.
    uint256[4] public bucketAccrued;
    mapping(address recipient => uint256 amount) public claimable;

    error Unauthorized();
    error InvalidFeePolicy();
    error NothingToClaim();
    error NativeTransferFailed();

    event CurveFeesAccrued(
        uint256 fee, uint256 creatorAmount, uint256 treasuryAmount, uint256 operatingAmount, uint256 futureReserveAmount
    );
    event CurveFeeClaimed(address indexed recipient, uint256 amount);
    event CurveAccrualMoved(address indexed previousCurve, address indexed activeCurve);

    constructor(
        address creator_,
        address treasury_,
        uint16 treasuryShareBps_,
        address operatingRecipient_,
        address futureReserveRecipient_
    ) {
        if (
            creator_ == address(0) || operatingRecipient_ == address(0) || futureReserveRecipient_ == address(0)
                || operatingRecipient_ == futureReserveRecipient_ || treasuryShareBps_ > BPS - PLATFORM_BPS
                || (treasury_ == address(0)) != (treasuryShareBps_ == 0) || treasury_ == creator_
        ) revert InvalidFeePolicy();
        curve = msg.sender;
        activeCurve = msg.sender;
        creator = creator_;
        treasury = treasury_;
        treasuryShareBps = treasuryShareBps_;
        operatingRecipient = operatingRecipient_;
        futureReserveRecipient = futureReserveRecipient_;
    }

    function accrue() external payable {
        if (msg.sender != activeCurve) revert Unauthorized();
        totalAccrued += msg.value;
        uint256 platform = Math.mulDiv(totalAccrued, PLATFORM_BPS, BPS);
        uint256 operating = platform / 2;
        uint256 project = totalAccrued - platform;
        // Nested cumulative floors keep all four buckets monotone across tiny trades.
        uint256 treasuryTotal = Math.mulDiv(project, treasuryShareBps, BPS - PLATFORM_BPS);
        uint256 creatorAmount = _credit(0, creator, project - treasuryTotal);
        uint256 treasuryAmount = _credit(1, treasury, treasuryTotal);
        uint256 operatingAmount = _credit(2, operatingRecipient, operating);
        uint256 reserveAmount = _credit(3, futureReserveRecipient, platform - operating);
        emit CurveFeesAccrued(msg.value, creatorAmount, treasuryAmount, operatingAmount, reserveAmount);
    }

    /// @notice The active immutable curve changes its successor's accrual access during the asset transition.
    /// @dev Neither escrow balances nor recipient rights move.
    function moveAccrual(address nextCurve) external {
        if (msg.sender != activeCurve || nextCurve.code.length == 0 || nextCurve == msg.sender) revert Unauthorized();
        activeCurve = nextCurve;
        emit CurveAccrualMoved(msg.sender, nextCurve);
    }

    function _credit(uint256 bucket, address recipient, uint256 total) private returns (uint256 amount) {
        amount = total - bucketAccrued[bucket];
        if (amount != 0) {
            bucketAccrued[bucket] = total;
            claimable[recipient] += amount;
        }
    }

    function claim() external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimed += amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
        emit CurveFeeClaimed(msg.sender, amount);
    }
}
