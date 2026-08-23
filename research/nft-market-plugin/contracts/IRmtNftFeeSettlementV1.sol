// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Research interface only. Not deployed and not production-authorized.
/// @dev A production implementation MUST pin/verify the provider target and decode
///      an allowlisted Seaport selector. This interface intentionally does not
///      authorize arbitrary provider calls merely because calldata is supplied.
interface IRmtNftFeeSettlementV1 {
    enum Side { BUY, SELL }

    struct ExecutionCommitment {
        bytes32 policyHash;
        bytes32 quoteHash;
        bytes32 orderHash;
        bytes32 providerCalldataHash;
        bytes32 executionId;
        Side side;
        address user;
        address nftRecipient;
        address nftContract;
        uint256 tokenId;
        uint256 quantity;
        address paymentToken; // address(0) = native ETH
        uint256 venueGrossPayment;
        uint256 rmtFee;
        address treasury;
        uint256 deadline;
    }

    event RmtNftFeeSettled(
        bytes32 indexed executionId,
        bytes32 indexed orderHash,
        address indexed user,
        Side side,
        address paymentToken,
        uint256 venueGrossPayment,
        uint256 rmtFee,
        address treasury
    );

    function executeSeaportListingBuy(
        ExecutionCommitment calldata commitment,
        bytes calldata verifiedSeaportCalldata
    ) external payable returns (bytes32 executionId);

    function executeSeaportOfferSell(
        ExecutionCommitment calldata commitment,
        bytes calldata sellerCounterOrder,
        bytes calldata sellerCounterOrderSignature,
        bytes calldata verifiedSeaportMatchCalldata
    ) external returns (bytes32 executionId);
}
