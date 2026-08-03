// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Creator-controlled ERC-721 collection bound to one immutable V7 release and token manifest.
/// @dev ERC-2981 communicates a royalty preference; it cannot force a marketplace to pay.
contract RMTV7CreatorCollection is ERC721URIStorage, ERC2981, ReentrancyGuard {
    uint16 public constant MAXIMUM_ROYALTY_BPS = 1_000;
    uint32 public constant MAXIMUM_COLLECTION_SUPPLY = 100_000;
    uint256 public constant MAXIMUM_NAME_BYTES = 100;
    uint256 public constant MAXIMUM_SYMBOL_BYTES = 20;
    uint256 public constant MAXIMUM_COLLECTION_URI_BYTES = 2_048;
    uint256 public constant MAXIMUM_TOKEN_URI_BYTES = 2_048;

    bytes32 public immutable releaseId;
    bytes32 public immutable configurationHash;
    bytes32 public immutable tokenManifestRoot;
    address public immutable originalCreator;
    uint32 public immutable maximumSupply;
    string public collectionURI;
    uint32 public totalMinted;

    error OnlyCreator();
    error InvalidConfiguration();
    error SupplyExhausted();
    error InvalidManifestProof();

    event ManifestTokenMinted(
        uint256 indexed tokenId, address indexed recipient, bytes32 indexed tokenURIHash, string tokenURI
    );

    modifier onlyCreator() {
        if (msg.sender != originalCreator) revert OnlyCreator();
        _;
    }

    constructor(
        bytes32 releaseId_,
        bytes32 configurationHash_,
        address creator_,
        string memory name_,
        string memory symbol_,
        string memory collectionURI_,
        bytes32 tokenManifestRoot_,
        uint32 maximumSupply_,
        address royaltyReceiver_,
        uint16 royaltyBps_
    ) ERC721(name_, symbol_) {
        if (
            releaseId_ == bytes32(0) || configurationHash_ == bytes32(0) || creator_ == address(0)
                || bytes(name_).length == 0 || bytes(name_).length > MAXIMUM_NAME_BYTES || bytes(symbol_).length == 0
                || bytes(symbol_).length > MAXIMUM_SYMBOL_BYTES || bytes(collectionURI_).length == 0
                || bytes(collectionURI_).length > MAXIMUM_COLLECTION_URI_BYTES || tokenManifestRoot_ == bytes32(0)
                || maximumSupply_ == 0 || maximumSupply_ > MAXIMUM_COLLECTION_SUPPLY
                || royaltyBps_ > MAXIMUM_ROYALTY_BPS || (royaltyBps_ == 0 && royaltyReceiver_ != address(0))
                || (royaltyBps_ != 0 && royaltyReceiver_ == address(0))
        ) revert InvalidConfiguration();

        releaseId = releaseId_;
        configurationHash = configurationHash_;
        originalCreator = creator_;
        collectionURI = collectionURI_;
        tokenManifestRoot = tokenManifestRoot_;
        maximumSupply = maximumSupply_;
        if (royaltyBps_ != 0) _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    /// @notice Mints the next sequential token only when its exact ID and URI are in the frozen manifest.
    function mint(address recipient, string calldata tokenURI_, bytes32[] calldata proof)
        external
        onlyCreator
        nonReentrant
        returns (uint256 tokenId)
    {
        if (
            recipient == address(0) || bytes(tokenURI_).length == 0 || bytes(tokenURI_).length > MAXIMUM_TOKEN_URI_BYTES
        ) {
            revert InvalidConfiguration();
        }

        if (totalMinted >= maximumSupply) revert SupplyExhausted();
        unchecked {
            ++totalMinted;
        }
        tokenId = totalMinted;
        bytes32 tokenURIHash = keccak256(bytes(tokenURI_));
        bytes32 leaf = hashTokenManifestLeaf(tokenId, tokenURIHash);
        if (!MerkleProof.verifyCalldata(proof, tokenManifestRoot, leaf)) revert InvalidManifestProof();

        _mint(recipient, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _checkMintReceiver(recipient, tokenId);

        emit ManifestTokenMinted(tokenId, recipient, tokenURIHash, tokenURI_);
    }

    /// @dev Double-hashes the ABI-encoded value to remain compatible with safe standard Merkle trees.
    function hashTokenManifestLeaf(uint256 tokenId, bytes32 tokenURIHash) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(tokenId, tokenURIHash))));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _checkMintReceiver(address recipient, uint256 tokenId) private {
        if (recipient.code.length == 0) return;
        try IERC721Receiver(recipient).onERC721Received(msg.sender, address(0), tokenId, "") returns (bytes4 response) {
            if (response != IERC721Receiver.onERC721Received.selector) revert ERC721InvalidReceiver(recipient);
        } catch (bytes memory reason) {
            if (reason.length == 0) revert ERC721InvalidReceiver(recipient);
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }
}
