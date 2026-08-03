// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155URIStorage} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Creator-controlled ERC-1155 editions bound to one immutable V7 release and manifest.
/// @dev A terms hash is a provenance commitment, not an onchain grant or enforcement of legal rights.
contract RMTV7CreatorEditions is ERC1155URIStorage, ERC2981, ReentrancyGuard {
    uint16 public constant MAXIMUM_ROYALTY_BPS = 1_000;
    uint32 public constant MAXIMUM_EDITION_TYPES = 10_000;
    uint64 public constant MAXIMUM_TOTAL_SUPPLY = 1_000_000_000;
    uint256 public constant MAXIMUM_NAME_BYTES = 100;
    uint256 public constant MAXIMUM_SYMBOL_BYTES = 20;
    uint256 public constant MAXIMUM_COLLECTION_URI_BYTES = 2_048;
    uint256 public constant MAXIMUM_TOKEN_URI_BYTES = 2_048;

    bytes32 public immutable releaseId;
    bytes32 public immutable configurationHash;
    bytes32 public immutable editionManifestRoot;
    address public immutable originalCreator;
    uint32 public immutable maximumEditionTypes;
    uint64 public immutable maximumTotalSupply;
    string public name;
    string public symbol;
    string public collectionURI;
    uint32 public editionTypeCount;
    uint64 public totalMinted;

    mapping(uint256 tokenId => bool registered) public editionRegistered;
    mapping(uint256 tokenId => bytes32 editionConfigurationHash) public editionConfigurationHash;
    mapping(uint256 tokenId => bytes32 termsHash) public editionTermsHash;
    mapping(uint256 tokenId => uint64 maximumSupply) public editionMaximumSupply;
    mapping(uint256 tokenId => uint64 mintedSupply) public editionMintedSupply;

    error OnlyCreator();
    error InvalidConfiguration();
    error SupplyExhausted();
    error InvalidManifestProof();
    error EditionConfigurationMismatch();

    event ManifestEditionRegistered(
        uint256 indexed tokenId,
        bytes32 indexed tokenURIHash,
        bytes32 indexed termsHash,
        uint64 maximumSupply,
        string tokenURI
    );
    event ManifestEditionMinted(uint256 indexed tokenId, address indexed recipient, uint64 amount, uint64 mintedSupply);

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
        bytes32 editionManifestRoot_,
        uint32 maximumEditionTypes_,
        uint64 maximumTotalSupply_,
        address royaltyReceiver_,
        uint16 royaltyBps_
    ) ERC1155("") {
        if (
            releaseId_ == bytes32(0) || configurationHash_ == bytes32(0) || creator_ == address(0)
                || bytes(name_).length == 0 || bytes(name_).length > MAXIMUM_NAME_BYTES || bytes(symbol_).length == 0
                || bytes(symbol_).length > MAXIMUM_SYMBOL_BYTES || bytes(collectionURI_).length == 0
                || bytes(collectionURI_).length > MAXIMUM_COLLECTION_URI_BYTES || editionManifestRoot_ == bytes32(0)
                || maximumEditionTypes_ == 0 || maximumEditionTypes_ > MAXIMUM_EDITION_TYPES || maximumTotalSupply_ == 0
                || maximumTotalSupply_ > MAXIMUM_TOTAL_SUPPLY || royaltyBps_ > MAXIMUM_ROYALTY_BPS
                || (royaltyBps_ == 0 && royaltyReceiver_ != address(0))
                || (royaltyBps_ != 0 && royaltyReceiver_ == address(0))
        ) revert InvalidConfiguration();

        releaseId = releaseId_;
        configurationHash = configurationHash_;
        originalCreator = creator_;
        name = name_;
        symbol = symbol_;
        collectionURI = collectionURI_;
        editionManifestRoot = editionManifestRoot_;
        maximumEditionTypes = maximumEditionTypes_;
        maximumTotalSupply = maximumTotalSupply_;
        if (royaltyBps_ != 0) _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    /// @notice Mints an amount from one immutable manifest edition.
    /// @dev The first mint registers the ID's URI, terms and supply ceiling; later mints must match them exactly.
    function mintEdition(
        address recipient,
        uint256 tokenId,
        uint64 amount,
        string calldata tokenURI_,
        bytes32 termsHash,
        uint64 editionSupply,
        bytes32[] calldata proof
    ) external onlyCreator nonReentrant {
        if (
            recipient == address(0) || tokenId == 0 || amount == 0 || bytes(tokenURI_).length == 0
                || bytes(tokenURI_).length > MAXIMUM_TOKEN_URI_BYTES || termsHash == bytes32(0) || editionSupply == 0
                || editionSupply > maximumTotalSupply
        ) revert InvalidConfiguration();

        bytes32 tokenURIHash = keccak256(bytes(tokenURI_));
        bytes32 leaf = hashEditionManifestLeaf(tokenId, tokenURIHash, termsHash, editionSupply);
        if (!MerkleProof.verifyCalldata(proof, editionManifestRoot, leaf)) revert InvalidManifestProof();

        bytes32 editionHash = keccak256(abi.encode(tokenURIHash, termsHash, editionSupply));
        bytes32 registeredHash = editionConfigurationHash[tokenId];
        if (!editionRegistered[tokenId]) {
            if (editionTypeCount >= maximumEditionTypes) revert SupplyExhausted();
            editionRegistered[tokenId] = true;
            editionConfigurationHash[tokenId] = editionHash;
            editionTermsHash[tokenId] = termsHash;
            editionMaximumSupply[tokenId] = editionSupply;
            unchecked {
                ++editionTypeCount;
            }
            _setURI(tokenId, tokenURI_);
            emit ManifestEditionRegistered(tokenId, tokenURIHash, termsHash, editionSupply, tokenURI_);
        } else if (registeredHash != editionHash) {
            revert EditionConfigurationMismatch();
        }

        uint64 nextEditionSupply = editionMintedSupply[tokenId] + amount;
        uint64 nextTotalSupply = totalMinted + amount;
        if (nextEditionSupply > editionSupply || nextTotalSupply > maximumTotalSupply) revert SupplyExhausted();
        editionMintedSupply[tokenId] = nextEditionSupply;
        totalMinted = nextTotalSupply;

        _mint(recipient, tokenId, amount, "");
        emit ManifestEditionMinted(tokenId, recipient, amount, nextEditionSupply);
    }

    /// @dev Double-hashes the ABI-encoded value to remain compatible with safe standard Merkle trees.
    function hashEditionManifestLeaf(uint256 tokenId, bytes32 tokenURIHash, bytes32 termsHash, uint64 editionSupply)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(tokenId, tokenURIHash, termsHash, editionSupply))));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
