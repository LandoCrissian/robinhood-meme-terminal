// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTLaunchBondingCurveV1} from "./RMTLaunchBondingCurveV1.sol";
import {RMTLaunchCurveTokenV1} from "./RMTLaunchCurveTokenV1.sol";
import {IRMTV4CurveGraduationV1} from "./interfaces/IRMTV4CurveGraduationV1.sol";

interface IRMTLaunchCurveRegistryV1 {
    function register(address token, address curve) external;
}

/// @notice Gas-only creation factory for the immutable curve engine V1.
contract RMTLaunchCurveFactoryV1 {
    uint32 public constant engineVersion = 1;
    IRMTV4CurveGraduationV1 public immutable graduationEngine;
    address public immutable operatingRecipient;
    address public immutable futureReserveRecipient;
    IRMTLaunchCurveRegistryV1 public immutable projectRegistry;

    mapping(address token => address curve) public curveForToken;
    mapping(address creator => mapping(bytes32 intentId => address token)) public tokenForIntent;

    error WrongChain();
    error InvalidConfiguration();
    error InvalidLaunch();
    error DuplicateIntent();
    error DeadlineExpired();

    event CurveCreated(
        address indexed token,
        address indexed curve,
        address indexed creator,
        bytes32 intentId,
        uint256 supply,
        address revenueLedger,
        address treasury,
        uint16 treasuryShareBps,
        string name,
        string symbol,
        string projectURI
    );

    constructor(
        address graduationEngine_,
        address operatingRecipient_,
        address futureReserveRecipient_,
        address projectRegistry_
    ) {
        if (block.chainid != 31_337) revert WrongChain();
        // Registry-free construction is restricted to isolated local unit fixtures.
        if (projectRegistry_ == address(0) && block.chainid != 31337) revert InvalidConfiguration();
        if (
            graduationEngine_.code.length == 0 || operatingRecipient_ == address(0)
                || futureReserveRecipient_ == address(0) || operatingRecipient_ == futureReserveRecipient_
                || (projectRegistry_ != address(0) && projectRegistry_.code.length == 0)
                || IRMTV4CurveGraduationV1(graduationEngine_).factory() != address(this)
        ) revert InvalidConfiguration();
        graduationEngine = IRMTV4CurveGraduationV1(graduationEngine_);
        operatingRecipient = operatingRecipient_;
        futureReserveRecipient = futureReserveRecipient_;
        projectRegistry = IRMTLaunchCurveRegistryV1(projectRegistry_);
    }

    function create(
        string calldata name,
        string calldata symbol,
        string calldata projectURI,
        uint8 supplyPreset,
        address treasury,
        uint16 treasuryShareBps,
        bytes32 intentId,
        uint256 deadline
    ) external returns (address token, address curve) {
        if (block.chainid != 31_337) revert WrongChain();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (
            bytes(name).length == 0 || bytes(name).length > 48 || bytes(symbol).length == 0 || bytes(symbol).length > 12
                || bytes(projectURI).length > 196 || supplyPreset > 2 || intentId == bytes32(0)
                || treasuryShareBps > 9_000 || treasury == msg.sender
                || (treasury == address(0)) != (treasuryShareBps == 0)
        ) revert InvalidLaunch();
        if (tokenForIntent[msg.sender][intentId] != address(0)) revert DuplicateIntent();
        uint256 supply = 1_000_000 ether * (10 ** supplyPreset);
        bytes32 salt = keccak256(abi.encode(msg.sender, intentId));
        RMTLaunchCurveTokenV1 launchedToken = new RMTLaunchCurveTokenV1{salt: salt}(name, symbol, supply);
        RMTLaunchBondingCurveV1 market = new RMTLaunchBondingCurveV1(
            IERC20(address(launchedToken)),
            msg.sender,
            treasury,
            treasuryShareBps,
            operatingRecipient,
            futureReserveRecipient,
            graduationEngine,
            address(projectRegistry)
        );
        token = address(launchedToken);
        curve = address(market);
        tokenForIntent[msg.sender][intentId] = token;
        curveForToken[token] = curve;
        if (!launchedToken.transfer(curve, supply)) revert InvalidLaunch();
        if (address(projectRegistry) != address(0)) projectRegistry.register(token, curve);
        emit CurveCreated(
            token,
            curve,
            msg.sender,
            intentId,
            supply,
            address(market.revenueLedger()),
            treasury,
            treasuryShareBps,
            name,
            symbol,
            projectURI
        );
    }
}
