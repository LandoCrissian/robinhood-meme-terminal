// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { TestBase } from "./TestBase.sol";

contract EpochBuilderVectorTest is TestBase {
    bytes32 internal constant LEAF_DOMAIN =
        0x47313ccea952a5802ce51dd358acf64dacb52c83f873d74fff2bbf6f0fd2eb16;
    bytes32 internal constant POLICY_HASH =
        0x9199827b32332fc31a20d3c88fef4a602275345bd7c6e0f2d18859c5d86042c4;
    bytes32 internal constant ROOT =
        0x514e0688ad973ec95f197e4c9e814bd1e4f5d71ea6d319668dbefacc14bfbe8a;

    uint256 internal constant CHAIN_ID = 4663;
    uint256 internal constant EPOCH_ID = 7;
    address internal constant DISTRIBUTOR = 0x1111111111111111111111111111111111111111;

    function testPythonPolicyAndDomainVectorsMatchSolidityKeccak() public pure {
        assertEq(
            keccak256(
                "POH_POLICY_V1|curve=sqrt|base=1e18|maxBonus=0.75e18|maxAge=365days|tiers=7,30,90,180,365"
            ),
            POLICY_HASH
        );
        assertEq(keccak256("POH_EPOCH_REWARD_LEAF_V1"), LEAF_DOMAIN);
    }

    function testPythonClaimZeroVectorVerifiesInOpenZeppelin() public pure {
        address account = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
        uint256 amount = 21_285_289_747_399_702_824;
        bytes32 expectedLeaf =
            0x9c59d446ff1bb7ed62c5e8e814c4bd298eaf1078add80442356c6b9f3d4cc0ff;

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = 0x8e0bcb0901929156d6f3a7b51da9742c604679ffa9db4c8ffa2cbd89262ac235;
        proof[1] = 0xcb40f39b7e60a14f02fab32cd030b358ce9eef0cd28e4bec50a693675abb68af;

        bytes32 leaf = _leaf(0, account, amount);
        assertEq(leaf, expectedLeaf);
        assertTrue(MerkleProof.verify(proof, ROOT, leaf));
    }

    function testPythonClaimOneVectorVerifiesInOpenZeppelin() public pure {
        address account = 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB;
        uint256 amount = 22_994_056_463_595_839_525;
        bytes32 expectedLeaf =
            0xcb40f39b7e60a14f02fab32cd030b358ce9eef0cd28e4bec50a693675abb68af;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = 0xbd4bad9c020af643212ce9e0179ebef883401ed7356852b13ac81c40bb195d24;

        bytes32 leaf = _leaf(1, account, amount);
        assertEq(leaf, expectedLeaf);
        assertTrue(MerkleProof.verify(proof, ROOT, leaf));
    }

    function testPythonClaimTwoVectorVerifiesInOpenZeppelin() public pure {
        address account = 0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC;
        uint256 amount = 55_720_653_789_004_457_654;
        bytes32 expectedLeaf =
            0x8e0bcb0901929156d6f3a7b51da9742c604679ffa9db4c8ffa2cbd89262ac235;

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = 0x9c59d446ff1bb7ed62c5e8e814c4bd298eaf1078add80442356c6b9f3d4cc0ff;
        proof[1] = 0xcb40f39b7e60a14f02fab32cd030b358ce9eef0cd28e4bec50a693675abb68af;

        bytes32 leaf = _leaf(2, account, amount);
        assertEq(leaf, expectedLeaf);
        assertTrue(MerkleProof.verify(proof, ROOT, leaf));
    }

    function _leaf(uint256 index, address account, uint256 amount)
        internal
        pure
        returns (bytes32)
    {
        bytes32 innerHash = keccak256(
            abi.encode(
                LEAF_DOMAIN,
                CHAIN_ID,
                DISTRIBUTOR,
                EPOCH_ID,
                index,
                account,
                amount
            )
        );
        return keccak256(bytes.concat(innerHash));
    }
}
