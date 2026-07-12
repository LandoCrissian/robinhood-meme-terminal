// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CloneBondingCurveMarket} from "./clone/CloneBondingCurveMarket.sol";
import {CloneFixedSupplyMemeToken} from "./clone/CloneFixedSupplyMemeToken.sol";
import {CloneLaunchRewardVault} from "./clone/CloneLaunchRewardVault.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

contract LowCostMemeLaunchFactory {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;

    address public immutable graduationAdapter;
    address public immutable tokenImplementation;
    address public immutable rewardVaultImplementation;
    address public immutable marketImplementation;
    uint16 public immutable marketFeeBps;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable graduationTarget;

    struct Launch {
        address token;
        address market;
        address rewardVault;
        bytes32 graduationPoolId;
        address creator;
        uint64 createdAt;
    }

    Launch[] private _launches;
    mapping(bytes32 => bool) private _usedNameHashes;
    mapping(bytes32 => bool) private _usedSymbolHashes;

    event TokenLaunched(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address market,
        address rewardVault,
        bytes32 graduationPoolId,
        string name,
        string symbol,
        string metadataURI,
        uint16[5] rewardBps
    );

    error EmptyName();
    error EmptySymbol();
    error DuplicateName();
    error DuplicateSymbol();
    error InvalidRewardSplit();
    error InvalidConfiguration();
    error InventoryTransferFailed();
    error InvalidPoolReservation();

    constructor(
        address graduationAdapter_,
        uint16 marketFeeBps_,
        uint256 initialVirtualEthReserve_,
        uint256 initialVirtualTokenReserve_,
        uint256 graduationTarget_
    ) {
        if (
            graduationAdapter_ == address(0) || marketFeeBps_ >= 10_000 || initialVirtualEthReserve_ == 0
                || initialVirtualTokenReserve_ <= TOKEN_SUPPLY || graduationTarget_ == 0
        ) revert InvalidConfiguration();

        graduationAdapter = graduationAdapter_;
        marketFeeBps = marketFeeBps_;
        initialVirtualEthReserve = initialVirtualEthReserve_;
        initialVirtualTokenReserve = initialVirtualTokenReserve_;
        graduationTarget = graduationTarget_;
        tokenImplementation = address(new CloneFixedSupplyMemeToken());
        rewardVaultImplementation = address(new CloneLaunchRewardVault());
        marketImplementation = address(new CloneBondingCurveMarket());
    }

    function launch(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address[4] calldata communityRecipients,
        uint16[5] calldata rewardBps
    ) external returns (address token, address market, address rewardVault) {
        return _launch(msg.sender, name, symbol, metadataURI, communityRecipients, rewardBps);
    }

    function _launch(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address[4] memory communityRecipients,
        uint16[5] memory rewardBps
    ) internal returns (address token, address market, address rewardVault) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();

        bytes32 nameHash = _canonicalHash(name);
        bytes32 symbolHash = _canonicalHash(symbol);
        if (_usedNameHashes[nameHash]) revert DuplicateName();
        if (_usedSymbolHashes[symbolHash]) revert DuplicateSymbol();

        uint256 totalBps;
        for (uint256 i; i < rewardBps.length; ++i) {
            totalBps += rewardBps[i];
        }
        if (totalBps != 10_000) revert InvalidRewardSplit();

        address[5] memory recipients =
            [creator, communityRecipients[0], communityRecipients[1], communityRecipients[2], communityRecipients[3]];

        _usedNameHashes[nameHash] = true;
        _usedSymbolHashes[symbolHash] = true;

        token = MinimalProxy.clone(tokenImplementation);
        CloneFixedSupplyMemeToken(token).initialize(name, symbol, TOKEN_SUPPLY, creator, address(this), metadataURI);

        bytes32 poolId = IGraduationAdapter(graduationAdapter).prepare(token);
        if (poolId == bytes32(0)) revert InvalidPoolReservation();

        rewardVault = MinimalProxy.clone(rewardVaultImplementation);
        CloneLaunchRewardVault(payable(rewardVault)).initialize(recipients, rewardBps);

        market = MinimalProxy.clone(marketImplementation);
        CloneBondingCurveMarket(payable(market))
            .initialize(
                token,
                payable(rewardVault),
                graduationAdapter,
                poolId,
                marketFeeBps,
                initialVirtualEthReserve,
                initialVirtualTokenReserve,
                graduationTarget
            );

        IGraduationAdapter(graduationAdapter).bindMarket(token, market);
        if (!CloneFixedSupplyMemeToken(token).transfer(market, TOKEN_SUPPLY)) revert InventoryTransferFailed();

        uint256 launchId = _launches.length;
        _launches.push(Launch(token, market, rewardVault, poolId, creator, uint64(block.timestamp)));
        emit TokenLaunched(launchId, token, creator, market, rewardVault, poolId, name, symbol, metadataURI, rewardBps);
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function getLaunch(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function _canonicalHash(string calldata value) private pure returns (bytes32) {
        bytes memory normalized = bytes(value);
        for (uint256 i; i < normalized.length; ++i) {
            uint8 character = uint8(normalized[i]);
            if (character >= 65 && character <= 90) normalized[i] = bytes1(character + 32);
        }
        return keccak256(normalized);
    }
}
