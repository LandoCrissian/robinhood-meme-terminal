// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Per-launch V6 fee splitter that pays creator and protocol treasury directly.
/// @dev Only explicit deposits from the permanently bound launch market and graduation adapter can account native
///      fees, and only the adapter can account launched-token fees. Empty-calldata transfers are rejected so seller
///      proceeds or refunds cannot be mistaken for fees. Failed payouts are credited for pull-based recovery.
contract DirectLaunchFeeSplitter {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant DIRECT_PAYMENT_GAS = 30_000;

    address public originalCreator;
    address payable public creator;
    address public creatorPayoutAuthority;
    uint256 public creatorPayoutNonce;
    address payable public protocolTreasury;
    address public launchToken;
    address public authorizedMarket;
    address public graduationAdapter;
    uint16 public creatorShareBps;
    bool private _initialized;
    bool private _entered;

    mapping(address recipient => uint256 amount) public pending;
    mapping(address token => mapping(address recipient => uint256 amount)) public pendingToken;
    /// @notice Fractional creator-share numerator carried for each native-fee recipient, denominated in basis points.
    /// @dev Recipient-scoped carry prevents permissionless collection cadence from biasing the 70/30 split and prevents
    ///      a payout redirect from transferring a prior recipient's fractional entitlement to the next recipient.
    mapping(address recipient => uint256 remainder) public nativeCreatorShareRemainder;
    /// @notice Fractional creator-share numerator carried independently per launched token and fee recipient.
    mapping(address token => mapping(address recipient => uint256 remainder)) public tokenCreatorShareRemainder;
    uint256 public totalReceived;
    uint256 public totalPaid;
    mapping(address token => uint256 amount) public totalTokenReceived;
    mapping(address token => uint256 amount) public totalTokenPaid;

    event Initialized(
        address indexed creator,
        address indexed protocolTreasury,
        address indexed launchToken,
        uint16 creatorShareBps,
        address creatorPayoutAuthority,
        address authorizedMarket,
        address graduationAdapter
    );
    event FeeReceived(address indexed payer, uint256 amount);
    event DirectPayment(address indexed recipient, uint256 amount);
    event PaymentDeferred(address indexed recipient, uint256 amount);
    event DeferredPaymentClaimed(address indexed recipient, uint256 amount);
    event TokenFeeReceived(address indexed payer, address indexed token, uint256 amount);
    event DirectTokenPayment(address indexed token, address indexed recipient, uint256 amount);
    event TokenPaymentDeferred(address indexed token, address indexed recipient, uint256 amount);
    event DeferredTokenPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);
    event CreatorWalletChanged(
        address indexed previousCreator,
        address indexed newCreator,
        address indexed authority,
        bytes32 evidenceHash,
        uint256 nonce
    );
    event CreatorPayoutNonceInvalidated(
        uint256 indexed previousNonce, uint256 indexed newNonce, address indexed protocolTreasury
    );

    error AlreadyInitialized();
    error InvalidConfiguration();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantCall();
    error OnlyCreatorPayoutAuthority();
    error OnlyProtocolTreasury();
    error InvalidCreatorPayoutNonce();
    error UnauthorizedFeeSource();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    function initialize(
        address payable creator_,
        address payable protocolTreasury_,
        address launchToken_,
        uint16 creatorShareBps_,
        address creatorPayoutAuthority_,
        address authorizedMarket_,
        address graduationAdapter_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (
            creator_ == address(0) || protocolTreasury_ == address(0) || launchToken_ == address(0)
                || launchToken_.code.length == 0 || creatorPayoutAuthority_ == address(0)
                || creatorPayoutAuthority_.code.length == 0 || authorizedMarket_ == address(0)
                || authorizedMarket_.code.length == 0 || graduationAdapter_ == address(0)
                || graduationAdapter_.code.length == 0 || creatorShareBps_ > BPS_DENOMINATOR
        ) revert InvalidConfiguration();

        _initialized = true;
        originalCreator = creator_;
        creator = creator_;
        protocolTreasury = protocolTreasury_;
        launchToken = launchToken_;
        creatorShareBps = creatorShareBps_;
        creatorPayoutAuthority = creatorPayoutAuthority_;
        authorizedMarket = authorizedMarket_;
        graduationAdapter = graduationAdapter_;
        emit Initialized(
            creator_,
            protocolTreasury_,
            launchToken_,
            creatorShareBps_,
            creatorPayoutAuthority_,
            authorizedMarket_,
            graduationAdapter_
        );
    }

    receive() external payable {
        revert UnauthorizedFeeSource();
    }

    function deposit() external payable nonReentrant {
        _split(msg.sender, msg.value);
    }

    /// @notice Moves future creator-fee payments to RMT treasury, or restores the immutable original creator.
    /// @dev Only delayed RMT governance can execute this change. The expected nonce prevents stale or out-of-order
    ///      governance proposals from changing the live recipient after a later change or treasury invalidation.
    function setCreatorWallet(address payable nextCreator, bytes32 evidenceHash, uint256 expectedNonce)
        external
        nonReentrant
    {
        if (msg.sender != creatorPayoutAuthority) revert OnlyCreatorPayoutAuthority();
        if (expectedNonce != creatorPayoutNonce) revert InvalidCreatorPayoutNonce();
        if (
            (nextCreator != originalCreator && nextCreator != protocolTreasury) || nextCreator == creator
                || evidenceHash == bytes32(0)
        ) revert InvalidConfiguration();

        address payable previous = creator;
        creatorPayoutNonce = expectedNonce + 1;
        creator = nextCreator;
        emit CreatorWalletChanged(previous, nextCreator, msg.sender, evidenceHash, expectedNonce);
    }

    /// @notice Lets the immutable RMT treasury invalidate every unexecuted payout-change proposal at the current nonce.
    /// @dev This cannot select a recipient or move funds. It lets the treasury invalidate a queued governance call
    ///      immediately even when the treasury is not itself a governance signer able to cancel that proposal.
    function invalidateCreatorPayoutNonce(uint256 expectedNonce) external nonReentrant {
        if (msg.sender != protocolTreasury) revert OnlyProtocolTreasury();
        if (expectedNonce != creatorPayoutNonce) revert InvalidCreatorPayoutNonce();
        creatorPayoutNonce = expectedNonce + 1;
        emit CreatorPayoutNonceInvalidated(expectedNonce, expectedNonce + 1, msg.sender);
    }

    function claimDeferred() external nonReentrant {
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingToClaim();

        pending[msg.sender] = 0;
        totalPaid += amount;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit DeferredPaymentClaimed(msg.sender, amount);
    }

    /// @notice Accounts for launched-token fees transferred by the bound graduation adapter.
    function depositToken(address token, uint256 amount) external nonReentrant {
        if (msg.sender != graduationAdapter) revert UnauthorizedFeeSource();
        if (!_initialized || token != launchToken || amount == 0) {
            revert InvalidConfiguration();
        }

        uint256 outstanding = totalTokenReceived[token] - totalTokenPaid[token];
        if (_tokenBalance(token) < outstanding + amount) revert InvalidConfiguration();
        totalTokenReceived[token] += amount;

        uint256 creatorAmount = _tokenCreatorAmount(token, creator, amount);
        uint256 protocolAmount = amount - creatorAmount;
        _payTokenOrCredit(token, creator, creatorAmount);
        _payTokenOrCredit(token, protocolTreasury, protocolAmount);
        emit TokenFeeReceived(msg.sender, token, amount);
    }

    function claimDeferredToken(address token) external nonReentrant {
        uint256 amount = pendingToken[token][msg.sender];
        if (amount == 0) revert NothingToClaim();

        pendingToken[token][msg.sender] = 0;
        totalTokenPaid[token] += amount;
        if (!_transferToken(token, msg.sender, amount)) revert TransferFailed();
        emit DeferredTokenPaymentClaimed(token, msg.sender, amount);
    }

    // All external paths into this helper are nonReentrant; recipient callbacks are covered by the adversarial test.
    // slither-disable-next-line reentrancy-eth
    function _split(address payer, uint256 amount) private {
        if (payer != authorizedMarket && payer != graduationAdapter) revert UnauthorizedFeeSource();
        if (!_initialized || amount == 0) revert InvalidConfiguration();
        totalReceived += amount;

        uint256 creatorAmount = _nativeCreatorAmount(creator, amount);
        uint256 protocolAmount = amount - creatorAmount;
        _payOrCredit(creator, creatorAmount);
        _payOrCredit(protocolTreasury, protocolAmount);
        emit FeeReceived(payer, amount);
    }

    function _payOrCredit(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        // Bound recipient execution so a gas-burning creator contract cannot make a trade or fee collection fail.
        // Wallets that need more execution gas retain the full amount as a recipient-specific pull balance.
        (bool success,) = recipient.call{value: amount, gas: DIRECT_PAYMENT_GAS}("");
        if (success) {
            totalPaid += amount;
            emit DirectPayment(recipient, amount);
        } else {
            pending[recipient] += amount;
            emit PaymentDeferred(recipient, amount);
        }
    }

    function _payTokenOrCredit(address token, address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (_transferToken(token, recipient, amount)) {
            totalTokenPaid[token] += amount;
            emit DirectTokenPayment(token, recipient, amount);
        } else {
            pendingToken[token][recipient] += amount;
            emit TokenPaymentDeferred(token, recipient, amount);
        }
    }

    /// @dev Splits using recipient-scoped carry. Across all deposits while a recipient is active, that recipient gets
    ///      floor(total fees * creatorShareBps / 10_000), independent of how permissionless collectors batch deposits.
    function _nativeCreatorAmount(address recipient, uint256 amount) private returns (uint256 creatorAmount) {
        uint256 numerator = (amount % BPS_DENOMINATOR) * creatorShareBps + nativeCreatorShareRemainder[recipient];
        creatorAmount = (amount / BPS_DENOMINATOR) * creatorShareBps + numerator / BPS_DENOMINATOR;
        nativeCreatorShareRemainder[recipient] = numerator % BPS_DENOMINATOR;
    }

    /// @dev Token-fee carry is independent from native-fee carry because each asset has its own atomic unit.
    function _tokenCreatorAmount(address token, address recipient, uint256 amount)
        private
        returns (uint256 creatorAmount)
    {
        uint256 numerator =
            (amount % BPS_DENOMINATOR) * creatorShareBps + tokenCreatorShareRemainder[token][recipient];
        creatorAmount = (amount / BPS_DENOMINATOR) * creatorShareBps + numerator / BPS_DENOMINATOR;
        tokenCreatorShareRemainder[token][recipient] = numerator % BPS_DENOMINATOR;
    }

    function _tokenBalance(address token) private view returns (uint256 balance) {
        (bool success, bytes memory data) =
            token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!success || data.length < 32) revert InvalidConfiguration();
        balance = abi.decode(data, (uint256));
    }

    function _transferToken(address token, address recipient, uint256 amount) private returns (bool) {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSignature("transfer(address,uint256)", recipient, amount));
        return success && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
    }
}
