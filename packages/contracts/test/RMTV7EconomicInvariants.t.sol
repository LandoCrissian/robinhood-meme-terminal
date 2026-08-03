// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RMTV7ConsentBoundSplit} from "../src/RMTV7ConsentBoundSplit.sol";
import {RMTV7CreatorEditions} from "../src/RMTV7CreatorEditions.sol";

interface V7EconomicVm {
    function deal(address account, uint256 balance) external;
}

contract V7EconomicToken is ERC20 {
    constructor() ERC20("V7 Economic Test", "V7E") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract RMTV7EconomicInvariantsTest {
    V7EconomicVm private constant vm = V7EconomicVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RECIPIENT_ONE = address(0xA11CE);
    address private constant RECIPIENT_TWO = address(0xB0B);
    address private constant RECIPIENT_THREE = address(0xCAFE);

    function testFuzzNativeSplitConservesEveryDeposit(uint96 rawFirst, uint96 rawSecond) public {
        uint256 first = _boundPositive(rawFirst, 100 ether);
        uint256 second = _boundPositive(rawSecond, 100 ether);
        RMTV7ConsentBoundSplit split = _newSplit();
        vm.deal(address(this), first + second);

        _fundNative(split, first);
        _releaseAllNative(split);
        _fundNative(split, second);
        _releaseAllNative(split);

        uint256 received = first + second;
        uint256 released = split.totalNativeReleased();
        require(released + address(split).balance == received, "native value was not conserved");
        require(split.nativeReleased(RECIPIENT_ONE) <= received * 3_333 / 10_000, "first overpaid");
        require(split.nativeReleased(RECIPIENT_TWO) <= received * 3_333 / 10_000, "second overpaid");
        require(split.nativeReleased(RECIPIENT_THREE) <= received * 3_334 / 10_000, "third overpaid");
        require(address(split).balance <= 2, "native rounding residue exceeded recipient bound");
    }

    function testFuzzERC20SplitConservesEveryDeposit(uint96 rawFirst, uint96 rawSecond) public {
        uint256 first = _boundPositive(rawFirst, 1_000_000 ether);
        uint256 second = _boundPositive(rawSecond, 1_000_000 ether);
        RMTV7ConsentBoundSplit split = _newSplit();
        V7EconomicToken token = new V7EconomicToken();

        token.mint(address(split), first);
        _releaseAllToken(split, token);
        token.mint(address(split), second);
        _releaseAllToken(split, token);

        uint256 received = first + second;
        uint256 released = split.totalTokenReleased(address(token));
        require(released + token.balanceOf(address(split)) == received, "token value was not conserved");
        require(token.balanceOf(address(split)) <= 2, "token rounding residue exceeded recipient bound");
    }

    function testFuzzEditionSupplyCannotExceedFrozenManifest(uint64 rawSupply, uint64 rawFirstMint) public {
        uint64 supply = uint64(uint256(rawSupply) % 1_000_000_000) + 1;
        uint64 firstMint = uint64(uint256(rawFirstMint) % supply) + 1;
        string memory tokenURI = "ipfs://bafy-v7-edition/metadata.json";
        bytes32 termsHash = keccak256("V7_EDITION_TERMS");
        bytes32 leaf = _editionLeaf(1, tokenURI, termsHash, supply);
        RMTV7CreatorEditions editions = new RMTV7CreatorEditions(
            keccak256("RELEASE"),
            keccak256("CONFIGURATION"),
            address(this),
            "RMT V7 Edition",
            "RMTV7E",
            "ipfs://bafy-v7-edition/collection.json",
            leaf,
            1,
            supply,
            address(0),
            0
        );
        bytes32[] memory proof = new bytes32[](0);

        editions.mintEdition(RECIPIENT_ONE, 1, firstMint, tokenURI, termsHash, supply, proof);
        uint64 remaining = supply - firstMint;
        if (remaining != 0) {
            editions.mintEdition(RECIPIENT_TWO, 1, remaining, tokenURI, termsHash, supply, proof);
        }

        require(editions.totalMinted() == supply, "collection supply did not reach exact cap");
        require(editions.editionMintedSupply(1) == supply, "edition supply did not reach exact cap");
        (bool exceeded,) = address(editions)
            .call(
                abi.encodeCall(
                    editions.mintEdition, (RECIPIENT_THREE, 1, uint64(1), tokenURI, termsHash, supply, proof)
                )
            );
        require(!exceeded, "edition exceeded frozen supply");
        require(editions.totalMinted() == supply, "failed mint changed total supply");
    }

    function _newSplit() private returns (RMTV7ConsentBoundSplit split) {
        address[] memory recipients = new address[](3);
        recipients[0] = RECIPIENT_ONE;
        recipients[1] = RECIPIENT_TWO;
        recipients[2] = RECIPIENT_THREE;
        uint16[] memory shares = new uint16[](3);
        shares[0] = 3_333;
        shares[1] = 3_333;
        shares[2] = 3_334;
        address[] memory recoveries = new address[](3);
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes32 payoutManifestHash = keccak256(abi.encode(recipients, shares));
        bytes32 consentManifestHash = keccak256(abi.encode(recipients, shares, recoveries, deadline));
        bytes32 configurationHash =
            keccak256(abi.encode(payoutManifestHash, consentManifestHash, deadline, recipients.length));
        split = new RMTV7ConsentBoundSplit(
            keccak256("RELEASE"),
            configurationHash,
            payoutManifestHash,
            consentManifestHash,
            address(this),
            recipients,
            shares,
            recoveries,
            deadline
        );
    }

    function _fundNative(RMTV7ConsentBoundSplit split, uint256 amount) private {
        (bool funded,) = address(split).call{value: amount}("");
        require(funded, "native funding failed");
    }

    function _releaseAllNative(RMTV7ConsentBoundSplit split) private {
        _releaseNativeIfAvailable(split, RECIPIENT_ONE);
        _releaseNativeIfAvailable(split, RECIPIENT_TWO);
        _releaseNativeIfAvailable(split, RECIPIENT_THREE);
    }

    function _releaseNativeIfAvailable(RMTV7ConsentBoundSplit split, address recipient) private {
        if (split.releasableNative(recipient) != 0) split.releaseNative(recipient);
    }

    function _releaseAllToken(RMTV7ConsentBoundSplit split, V7EconomicToken token) private {
        _releaseTokenIfAvailable(split, token, RECIPIENT_ONE);
        _releaseTokenIfAvailable(split, token, RECIPIENT_TWO);
        _releaseTokenIfAvailable(split, token, RECIPIENT_THREE);
    }

    function _releaseTokenIfAvailable(RMTV7ConsentBoundSplit split, V7EconomicToken token, address recipient) private {
        if (split.releasableToken(token, recipient) != 0) split.releaseToken(token, recipient);
    }

    function _editionLeaf(uint256 tokenId, string memory tokenURI, bytes32 termsHash, uint64 supply)
        private
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(tokenId, keccak256(bytes(tokenURI)), termsHash, supply))));
    }

    function _boundPositive(uint96 raw, uint256 maximum) private pure returns (uint256) {
        return uint256(raw) % maximum + 1;
    }
}
