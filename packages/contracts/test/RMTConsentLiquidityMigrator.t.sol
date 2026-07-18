// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ConsentLiquidityDeploymentBundle,
    DeployConsentLiquidityMigratorTestnet
} from "../script/DeployConsentLiquidityMigratorTestnet.s.sol";
import {RMTConsentLiquidityMigrator} from "../src/RMTConsentLiquidityMigrator.sol";
import {RMTConsentLiquiditySession} from "../src/RMTConsentLiquiditySession.sol";
import {ISushiV3Factory} from "../src/interfaces/ISushiV3Factory.sol";
import {ISushiV3Pool} from "../src/interfaces/ISushiV3Pool.sol";
import {ISushiV3PositionManager} from "../src/interfaces/ISushiV3PositionManager.sol";

interface ConsentMigrationVm {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function getNonce(address account) external view returns (uint64 nonce);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract ConsentMockERC20 is IERC20 {
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        totalSupply += amount;
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) public virtual returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) public virtual returns (bool) {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal virtual {
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract ConsentInboundFeeToken is ConsentMockERC20 {
    function _transfer(address owner, address recipient, uint256 amount) internal override {
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount - 1;
        totalSupply -= 1;
    }
}

contract ConsentOutboundFeeToken is ConsentMockERC20 {
    address public feeRecipient;

    function setFeeRecipient(address feeRecipient_) external {
        feeRecipient = feeRecipient_;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal override {
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        if (recipient == feeRecipient && amount != 0) {
            balanceOf[recipient] += amount - 1;
            totalSupply -= 1;
        } else {
            balanceOf[recipient] += amount;
        }
    }
}

contract ConsentSenderFeeToken is ConsentMockERC20 {
    address public feeSender;

    function setFeeSender(address feeSender_) external {
        feeSender = feeSender_;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal override {
        uint256 fee = owner == feeSender && amount != 0 ? 1 : 0;
        require(balanceOf[owner] >= amount + fee, "balance");
        balanceOf[owner] -= amount + fee;
        balanceOf[recipient] += amount;
        totalSupply -= fee;
    }
}

contract ConsentStickyApprovalToken is ConsentMockERC20 {
    function approve(address spender, uint256 amount) public override returns (bool) {
        if (amount != 0) allowance[msg.sender][spender] = amount;
        return true;
    }
}

interface ConsentPositionOwnerMutator {
    function forceOwner(uint256 positionId, address owner) external;
}

contract ConsentRefundHookToken is ConsentMockERC20 {
    ConsentPositionOwnerMutator public manager;
    address public refundRecipient;
    uint256 public positionId;
    address public replacementOwner;

    function arm(address manager_, address refundRecipient_, uint256 positionId_, address replacementOwner_) external {
        manager = ConsentPositionOwnerMutator(manager_);
        refundRecipient = refundRecipient_;
        positionId = positionId_;
        replacementOwner = replacementOwner_;
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        if (recipient == refundRecipient) manager.forceOwner(positionId, replacementOwner);
        return super.transfer(recipient, amount);
    }
}

contract ConsentRefundApprovalToken is ConsentMockERC20 {
    address public session;
    address public manager;
    address public refundRecipient;

    function arm(address session_, address manager_, address refundRecipient_) external {
        session = session_;
        manager = manager_;
        refundRecipient = refundRecipient_;
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        if (recipient == refundRecipient) allowance[session][manager] = 1;
        return super.transfer(recipient, amount);
    }
}

contract ConsentMockGovernance {
    function unpause(RMTConsentLiquidityMigrator migrator) external {
        migrator.unpause();
    }

    function pause(RMTConsentLiquidityMigrator migrator) external {
        migrator.pause();
    }
}

contract ConsentMockSushiV3Factory is ISushiV3Factory {
    address public pool;
    address public token0;
    address public token1;
    uint24 public poolFee;
    int24 public tickSpacing;

    function bindPool(address pool_, address token0_, address token1_, uint24 fee_, int24 tickSpacing_) external {
        require(pool == address(0), "bound");
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
        poolFee = fee_;
        tickSpacing = tickSpacing_;
    }

    function breakBinding() external {
        pool = address(0xBAD);
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        if (tokenA == token0 && tokenB == token1 && fee == poolFee) return pool;
        return address(0);
    }

    function feeAmountTickSpacing(uint24 fee) external view returns (int24) {
        return fee == poolFee ? tickSpacing : int24(0);
    }
}

contract ConsentMockSushiV3Pool is ISushiV3Pool {
    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    constructor(address factory_, address token0_, address token1_, uint24 fee_, int24 tickSpacing_) {
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }
}

contract ConsentMockSushiV3PositionManager is ISushiV3PositionManager {
    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    address public immutable factory;
    address public immutable WETH9;
    uint256 public totalSupply;
    mapping(uint256 tokenId => address owner) public ownerOf;
    mapping(uint256 tokenId => Position position) private _positions;
    uint256[] private _allPositionIds;
    uint256 public nextPositionId = 1;

    bool public customExecution;
    uint256 public amount0ToConsume;
    uint256 public amount1ToConsume;
    uint256 public amount0ToReport;
    uint256 public amount1ToReport;
    uint128 public liquidityToRecord = 1_000 ether;
    address public ownerOverride;
    uint256 public reusedPositionId;
    bool public corruptPosition;
    bool public mintUnrelatedWhenReusing;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setExecution(
        uint256 amount0Consumed,
        uint256 amount1Consumed,
        uint256 amount0Reported,
        uint256 amount1Reported,
        uint128 liquidity,
        address ownerOverride_,
        uint256 reusedPositionId_,
        bool corruptPosition_
    ) external {
        customExecution = true;
        amount0ToConsume = amount0Consumed;
        amount1ToConsume = amount1Consumed;
        amount0ToReport = amount0Reported;
        amount1ToReport = amount1Reported;
        liquidityToRecord = liquidity;
        ownerOverride = ownerOverride_;
        reusedPositionId = reusedPositionId_;
        corruptPosition = corruptPosition_;
    }

    function setMintUnrelatedWhenReusing(bool enabled) external {
        mintUnrelatedWhenReusing = enabled;
    }

    function forceOwner(uint256 positionId, address owner) external {
        ownerOf[positionId] = owner;
    }

    function seedExistingPosition(
        address owner,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external returns (uint256 positionId) {
        positionId = nextPositionId++;
        totalSupply += 1;
        ownerOf[positionId] = owner;
        _positions[positionId] = Position(token0, token1, fee, tickLower, tickUpper, liquidity);
        _allPositionIds.push(positionId);
    }

    function tokenByIndex(uint256 index) external view returns (uint256) {
        return _allPositionIds[index];
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 positionId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        uint256 consumed0 = customExecution ? amount0ToConsume : params.amount0Desired;
        uint256 consumed1 = customExecution ? amount1ToConsume : params.amount1Desired;
        require(IERC20(params.token0).transferFrom(msg.sender, address(this), consumed0), "token0 transfer");
        require(IERC20(params.token1).transferFrom(msg.sender, address(this), consumed1), "token1 transfer");

        amount0 = customExecution ? amount0ToReport : params.amount0Desired;
        amount1 = customExecution ? amount1ToReport : params.amount1Desired;
        liquidity = liquidityToRecord;
        if (reusedPositionId != 0) {
            if (mintUnrelatedWhenReusing) {
                uint256 unrelatedPositionId = nextPositionId++;
                totalSupply += 1;
                ownerOf[unrelatedPositionId] = params.recipient;
                _positions[unrelatedPositionId] = Position({
                    token0: params.token0,
                    token1: params.token1,
                    fee: params.fee,
                    tickLower: params.tickLower,
                    tickUpper: params.tickUpper,
                    liquidity: liquidity
                });
                _allPositionIds.push(unrelatedPositionId);
            }
            return (reusedPositionId, liquidity, amount0, amount1);
        }

        positionId = nextPositionId++;
        totalSupply += 1;
        ownerOf[positionId] = ownerOverride == address(0) ? params.recipient : ownerOverride;
        _positions[positionId] = Position({
            token0: corruptPosition ? address(0xBAD) : params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity
        });
        _allPositionIds.push(positionId);
    }

    function positions(uint256 positionId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position memory position = _positions[positionId];
        require(position.token0 != address(0), "missing");
        return (
            0,
            address(0),
            position.token0,
            position.token1,
            position.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            0,
            0,
            0,
            0
        );
    }
}

contract ConsentReentrantToken is ConsentMockERC20 {
    RMTConsentLiquidityMigrator public target;
    ConsentMockERC20 public counterToken;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bool private _attacking;

    function arm(RMTConsentLiquidityMigrator target_, ConsentMockERC20 counterToken_) external {
        target = target_;
        counterToken = counterToken_;
        balanceOf[address(this)] += 1 ether;
        totalSupply += 1 ether;
        allowance[address(this)][address(target_)] = 1 ether;
        counterToken_.mint(address(this), 1 ether);
        counterToken_.approve(address(target_), 1 ether);
    }

    function transferFrom(address owner, address recipient, uint256 amount) public override returns (bool) {
        _attemptReentry();
        return super.transferFrom(owner, recipient, amount);
    }

    function _attemptReentry() private {
        if (address(target) == address(0) || _attacking) return;
        _attacking = true;
        reentryAttempted = true;
        RMTConsentLiquidityMigrator.MigrationRequest memory request = RMTConsentLiquidityMigrator.MigrationRequest({
            pairedTokenDesired: 1 ether,
            wethDesired: 1 ether,
            pairedTokenMinimum: 1 ether,
            wethMinimum: 1 ether,
            minimumLiquidity: 1,
            tickLower: -120,
            tickUpper: 120,
            deadline: block.timestamp + 1 minutes,
            acceptedTermsHash: target.migrationTermsHash()
        });
        (reentrySucceeded,) = address(target).call(abi.encodeWithSelector(target.migrate.selector, request));
        _attacking = false;
    }
}

contract RMTConsentLiquidityMigratorTest {
    ConsentMigrationVm private constant vm =
        ConsentMigrationVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant DESTINATION_CHAIN_ID = 46_630;
    uint24 private constant POOL_FEE = 3_000;
    int24 private constant TICK_SPACING = 60;
    address private constant GUARDIAN = address(0xA11CE);
    bytes32 private constant TERMS_DOCUMENT_HASH = keccak256("RMT_CONSENT_MIGRATION_TERMS_V1");

    ConsentMockERC20 private weth;
    ConsentMockERC20 private pairedToken;
    ConsentMockGovernance private governance;
    ConsentMockSushiV3Factory private factory;
    ConsentMockSushiV3Pool private pool;
    ConsentMockSushiV3PositionManager private manager;
    RMTConsentLiquidityMigrator private migrator;

    function setUp() public {
        vm.chainId(DESTINATION_CHAIN_ID);
        vm.deal(address(this), 10 ether);
        weth = new ConsentMockERC20();
        pairedToken = new ConsentMockERC20();
        governance = new ConsentMockGovernance();
        (migrator, factory, pool, manager) = _deploy(weth, pairedToken, governance);
    }

    function testStartsPausedAndRequiresGovernanceToEnable() public {
        require(migrator.paused(), "not initially paused");
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        (bool migrated,) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        require(!migrated, "migrated while paused");

        governance.unpause(migrator);
        require(!migrator.paused(), "governance failed to enable");
        vm.prank(GUARDIAN);
        migrator.pause();
        require(migrator.paused(), "guardian failed to pause");
        governance.unpause(migrator);
        require(!migrator.paused(), "governance failed to re-enable");
    }

    function testDeploymentRehearsalIsHardDisabled() public {
        DeployConsentLiquidityMigratorTestnet deployment = new DeployConsentLiquidityMigratorTestnet();
        (bool deployed, bytes memory reason) = address(deployment).call(abi.encodeWithSelector(deployment.run.selector));
        require(!deployed, "zero-manifest deployment succeeded");
        require(
            _selector(reason) == DeployConsentLiquidityMigratorTestnet.DeploymentDisabled.selector,
            "deployment did not stop at hard gate"
        );
    }

    function testAtomicDeploymentBundleBindsPredictedSessionAndRouter() public {
        uint256 nextNonce = uint256(vm.getNonce(address(this)));
        address expectedBundle = vm.computeCreateAddress(address(this), nextNonce + 1);
        address expectedSession = vm.computeCreateAddress(expectedBundle, 1);
        address expectedMigrator = vm.computeCreateAddress(expectedBundle, 2);

        // The immutable-bearing runtime hash can be reproduced with the exact reviewed constructor values.
        RMTConsentLiquiditySession rehearsal =
            new RMTConsentLiquiditySession(expectedMigrator, pairedToken, weth, manager, POOL_FEE);
        RMTConsentLiquidityMigrator.Configuration memory config = RMTConsentLiquidityMigrator.Configuration({
            destinationChainId: DESTINATION_CHAIN_ID,
            governance: address(governance),
            guardian: GUARDIAN,
            weth: weth,
            pairedToken: pairedToken,
            positionManager: manager,
            factory: factory,
            pool: pool,
            session: RMTConsentLiquiditySession(payable(expectedSession)),
            poolFee: POOL_FEE,
            positionManagerCodeHash: address(manager).codehash,
            factoryCodeHash: address(factory).codehash,
            poolCodeHash: address(pool).codehash,
            sessionCodeHash: address(rehearsal).codehash,
            wethCodeHash: address(weth).codehash,
            pairedTokenCodeHash: address(pairedToken).codehash,
            termsDocumentHash: TERMS_DOCUMENT_HASH
        });

        ConsentLiquidityDeploymentBundle bundle = new ConsentLiquidityDeploymentBundle(
            expectedSession, expectedMigrator, pairedToken, weth, manager, POOL_FEE, config
        );
        require(address(bundle) == expectedBundle, "bundle address prediction");
        require(address(bundle.session()) == expectedSession, "session address prediction");
        require(address(bundle.migrator()) == expectedMigrator, "migrator address prediction");
        require(bundle.session().router() == expectedMigrator, "session router binding");
        require(address(bundle.migrator().liquiditySession()) == expectedSession, "router session binding");
        require(bundle.migrator().paused(), "bundle router not paused");
    }

    function testDirectMintIsFreshSelfCustodiedAndRefundsExactly() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 1_000 ether, 20 ether);
        _setUsage(migrator, manager, 800 ether, 12 ether, 800 ether, 12 ether, 1_000 ether);

        RMTConsentLiquidityMigrator.MigrationRequest memory request = _request(migrator, 1_000 ether, 20 ether);
        request.wethMinimum = 10 ether;
        bytes32 expectedMigrationId = _migrationId(migrator, address(this), 0, request);
        (bytes32 migrationId, uint256 positionId, uint128 liquidity) = migrator.migrate(request);
        RMTConsentLiquiditySession session = migrator.liquiditySession();

        require(migrationId == expectedMigrationId, "migration id");
        require(positionId == 1 && manager.totalSupply() == 1, "fresh position not proven");
        require(manager.ownerOf(positionId) == address(this), "position not self-custodied");
        require(liquidity == 1_000 ether, "liquidity");
        require(pairedToken.balanceOf(address(this)) == 200 ether, "paired refund");
        require(weth.balanceOf(address(this)) == 8 ether, "WETH refund");
        require(pairedToken.balanceOf(address(migrator)) == 0, "paired custody retained");
        require(weth.balanceOf(address(migrator)) == 0, "WETH custody retained");
        require(pairedToken.balanceOf(address(session)) == 0, "session paired custody retained");
        require(weth.balanceOf(address(session)) == 0, "session WETH custody retained");
        require(pairedToken.allowance(address(session), address(manager)) == 0, "paired approval retained");
        require(weth.allowance(address(session), address(manager)) == 0, "WETH approval retained");
        _requireSessionCleared(session);
        require(migrator.migrationNonces(address(this)) == 1, "nonce");
    }

    function testSupportsBothTokenOrders() public {
        bool firstOrder = migrator.pairedTokenIsToken0();
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        _setUsage(migrator, manager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);
        migrator.migrate(_request(migrator, 10 ether, 10 ether));
        require(manager.ownerOf(1) == address(this), "first-order position owner");

        // Swapping the same two token contracts between the WETH and paired-token roles
        // deterministically exercises the opposite token0/token1 ordering.
        ConsentMockGovernance reverseGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator reverseMigrator,,, ConsentMockSushiV3PositionManager reverseManager) =
            _deploy(pairedToken, weth, reverseGovernance);
        require(reverseMigrator.pairedTokenIsToken0() != firstOrder, "opposite token order not configured");
        reverseGovernance.unpause(reverseMigrator);
        _fundAndApprove(reverseMigrator, weth, pairedToken, 10 ether, 10 ether);
        _setUsage(reverseMigrator, reverseManager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);

        reverseMigrator.migrate(_request(reverseMigrator, 10 ether, 10 ether));
        require(reverseManager.ownerOf(1) == address(this), "reverse-order position owner");
        _requireSessionCleared(reverseMigrator.liquiditySession());
    }

    function testRejectsOldPositionReuseEvenWhenOwnerPairAndLiquidityMatch() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        uint256 oldPositionId = manager.seedExistingPosition(
            address(this), address(migrator.token0()), address(migrator.token1()), POOL_FEE, -120, 120, 1_000 ether
        );
        _setUsage(migrator, manager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);
        manager.setExecution(
            migrator.pairedTokenIsToken0() ? 10 ether : 10 ether,
            10 ether,
            10 ether,
            10 ether,
            1_000 ether,
            address(0),
            oldPositionId,
            false
        );
        manager.setMintUnrelatedWhenReusing(true);

        (bool migrated, bytes memory reason) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        require(!migrated, "old position accepted");
        require(_selector(reason) == RMTConsentLiquidityMigrator.PositionVerificationFailed.selector, "wrong error");
        require(pairedToken.balanceOf(address(this)) == 10 ether, "paired not reverted");
        require(weth.balanceOf(address(this)) == 10 ether, "WETH not reverted");
        require(manager.totalSupply() == 1, "unrelated position not reverted");
        require(manager.ownerOf(oldPositionId) == address(this), "old position changed");
        _requireSessionCleared(migrator.liquiditySession());
        require(migrator.migrationNonces(address(this)) == 0, "failed nonce retained");
    }

    function testOnlyRouterCanBeginOrExecuteSession() public {
        RMTConsentLiquiditySession session = migrator.liquiditySession();
        (bool began, bytes memory beginReason) =
            address(session).call(abi.encodeWithSelector(session.begin.selector, address(this), keccak256("migration")));
        require(!began, "non-router began session");
        require(_selector(beginReason) == RMTConsentLiquiditySession.Unauthorized.selector, "wrong begin error");

        RMTConsentLiquiditySession.SessionRequest memory request = RMTConsentLiquiditySession.SessionRequest({
            pairedTokenDesired: 10 ether,
            wethDesired: 10 ether,
            pairedTokenMinimum: 8 ether,
            wethMinimum: 8 ether,
            minimumLiquidity: 1,
            tickLower: -120,
            tickUpper: 120,
            deadline: block.timestamp + 10 minutes
        });
        (bool executed, bytes memory executeReason) =
            address(session).call(abi.encodeWithSelector(session.execute.selector, keccak256("migration"), request));
        require(!executed, "non-router executed session");
        require(_selector(executeReason) == RMTConsentLiquiditySession.Unauthorized.selector, "wrong execute error");
        _requireSessionCleared(session);
    }

    function testPreexistingDustCannotCensorMigrationAndIsPreservedExactly() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        _setUsage(migrator, manager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);
        RMTConsentLiquidityMigrator.MigrationRequest memory request = _request(migrator, 10 ether, 10 ether);
        RMTConsentLiquiditySession session = migrator.liquiditySession();

        pairedToken.mint(address(this), 1 ether);
        weth.mint(address(this), 1 ether);
        pairedToken.mint(address(session), 2 ether);
        weth.mint(address(session), 3 ether);
        pairedToken.mint(address(migrator), 4 ether);
        weth.mint(address(migrator), 5 ether);

        migrator.migrate(request);
        require(pairedToken.balanceOf(address(this)) == 3 ether, "paired owner balance wrong");
        require(weth.balanceOf(address(this)) == 3 ether, "WETH owner balance wrong");
        require(pairedToken.balanceOf(address(session)) == 2 ether, "paired session dust lost");
        require(weth.balanceOf(address(session)) == 3 ether, "WETH session dust lost");
        require(pairedToken.balanceOf(address(migrator)) == 4 ether, "paired router dust lost");
        require(weth.balanceOf(address(migrator)) == 5 ether, "WETH router dust lost");
        _requireSessionCleared(session);
    }

    function testRejectsManagerUsageMisreporting() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        _setUsage(migrator, manager, 8 ether, 8 ether, 9 ether, 8 ether, 1_000 ether);
        (bool migrated, bytes memory reason) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        require(!migrated, "false usage accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.SlippageExceeded.selector, "wrong usage error");
        require(pairedToken.balanceOf(address(this)) == 10 ether, "paired not reverted");
        require(weth.balanceOf(address(this)) == 10 ether, "WETH not reverted");
        require(manager.totalSupply() == 0, "misreported mint not reverted");
        require(migrator.migrationNonces(address(this)) == 0, "failed nonce retained");
        _requireSessionCleared(migrator.liquiditySession());
    }

    function testRejectsRedirectedOrCorruptPosition() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 20 ether, 20 ether);
        _setUsage(migrator, manager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);
        manager.setExecution(10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether, address(0xBAD), 0, false);
        (bool migrated, bytes memory reason) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        require(!migrated, "redirect accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.PositionVerificationFailed.selector, "redirect error");
        require(pairedToken.balanceOf(address(this)) == 20 ether, "redirect paired not reverted");
        require(weth.balanceOf(address(this)) == 20 ether, "redirect WETH not reverted");
        _requireSessionCleared(migrator.liquiditySession());

        manager.setExecution(10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether, address(0), 0, true);
        (migrated, reason) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        require(!migrated, "corrupt position accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.PositionVerificationFailed.selector, "corrupt error");
        require(pairedToken.balanceOf(address(this)) == 20 ether, "corrupt paired not reverted");
        require(weth.balanceOf(address(this)) == 20 ether, "corrupt WETH not reverted");
        require(manager.totalSupply() == 0, "corrupt mint not reverted");
        require(migrator.migrationNonces(address(this)) == 0, "failed nonce retained");
        _requireSessionCleared(migrator.liquiditySession());
    }

    function testTermsBindExactDeploymentAndAllRequestBounds() public {
        require(migrator.migrationTermsHash() != TERMS_DOCUMENT_HASH, "terms not domain bound");
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        RMTConsentLiquidityMigrator.MigrationRequest memory request = _request(migrator, 10 ether, 10 ether);
        request.acceptedTermsHash = TERMS_DOCUMENT_HASH;
        (bool migrated, bytes memory reason) = _tryMigrate(migrator, request);
        require(!migrated, "unbound terms accepted");
        require(_selector(reason) == RMTConsentLiquidityMigrator.TermsNotAccepted.selector, "wrong terms error");
        require(migrator.migrationNonces(address(this)) == 0, "failed nonce retained");
    }

    function testMigrationIdBindsEveryRequestField() public view {
        RMTConsentLiquidityMigrator.MigrationRequest memory base = _request(migrator, 10 ether, 10 ether);
        bytes32 expected = _migrationId(migrator, address(this), 0, base);
        require(_migrationId(migrator, address(0xBEEF), 0, base) != expected, "owner not bound");
        require(_migrationId(migrator, address(this), 1, base) != expected, "nonce not bound");

        RMTConsentLiquidityMigrator.MigrationRequest memory changed = base;
        changed.pairedTokenDesired += 1;
        _requireDifferentMigrationId(expected, changed, "paired desired not bound");
        changed = base;
        changed.wethDesired += 1;
        _requireDifferentMigrationId(expected, changed, "WETH desired not bound");
        changed = base;
        changed.pairedTokenMinimum += 1;
        _requireDifferentMigrationId(expected, changed, "paired minimum not bound");
        changed = base;
        changed.wethMinimum += 1;
        _requireDifferentMigrationId(expected, changed, "WETH minimum not bound");
        changed = base;
        changed.minimumLiquidity += 1;
        _requireDifferentMigrationId(expected, changed, "liquidity minimum not bound");
        changed = base;
        changed.tickLower -= TICK_SPACING;
        _requireDifferentMigrationId(expected, changed, "lower tick not bound");
        changed = base;
        changed.tickUpper += TICK_SPACING;
        _requireDifferentMigrationId(expected, changed, "upper tick not bound");
        changed = base;
        changed.deadline += 1;
        _requireDifferentMigrationId(expected, changed, "deadline not bound");
        changed = base;
        changed.acceptedTermsHash = keccak256("different terms");
        _requireDifferentMigrationId(expected, changed, "terms not bound");
    }

    function testEnforcesMinimumsLiquidityTicksAndDeadline() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 20 ether, 20 ether);
        _setUsage(migrator, manager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);
        RMTConsentLiquidityMigrator.MigrationRequest memory request = _request(migrator, 10 ether, 10 ether);
        request.pairedTokenMinimum = 9 ether;
        (bool migrated,) = _tryMigrate(migrator, request);
        require(!migrated, "minimum bypassed");

        request = _request(migrator, 10 ether, 10 ether);
        request.tickLower = -121;
        (migrated,) = _tryMigrate(migrator, request);
        require(!migrated, "unaligned tick accepted");

        request = _request(migrator, 10 ether, 10 ether);
        request.deadline = block.timestamp + 2 hours;
        (migrated,) = _tryMigrate(migrator, request);
        require(!migrated, "long execution window accepted");

        _setUsage(migrator, manager, 10 ether, 10 ether, 10 ether, 10 ether, 1);
        request = _request(migrator, 10 ether, 10 ether);
        request.minimumLiquidity = 2;
        (migrated,) = _tryMigrate(migrator, request);
        require(!migrated, "liquidity minimum bypassed");
    }

    function testRejectsInboundFeeToken() public {
        ConsentInboundFeeToken feeToken = new ConsentInboundFeeToken();
        ConsentMockGovernance feeGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator feeMigrator,,,) = _deploy(weth, feeToken, feeGovernance);
        feeGovernance.unpause(feeMigrator);
        _fundAndApprove(feeMigrator, feeToken, weth, 10 ether, 10 ether);
        (bool migrated, bytes memory reason) = _tryMigrate(feeMigrator, _request(feeMigrator, 10 ether, 10 ether));
        require(!migrated, "inbound fee token accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.InexactTokenTransfer.selector, "wrong inbound error");
        require(feeToken.balanceOf(address(this)) == 10 ether, "inbound fee not reverted");
        require(weth.balanceOf(address(this)) == 10 ether, "inbound WETH not reverted");
        require(feeMigrator.migrationNonces(address(this)) == 0, "failed nonce retained");
        _requireSessionCleared(feeMigrator.liquiditySession());
    }

    function testRejectsOutboundFeeThatShortchangesRefund() public {
        ConsentOutboundFeeToken feeToken = new ConsentOutboundFeeToken();
        ConsentMockGovernance feeGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator feeMigrator,,, ConsentMockSushiV3PositionManager feeManager) =
            _deploy(weth, feeToken, feeGovernance);
        feeToken.setFeeRecipient(address(this));
        feeGovernance.unpause(feeMigrator);
        _fundAndApprove(feeMigrator, feeToken, weth, 10 ether, 10 ether);
        _setUsage(feeMigrator, feeManager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);
        (bool migrated, bytes memory reason) = _tryMigrate(feeMigrator, _request(feeMigrator, 10 ether, 10 ether));
        require(!migrated, "short refund accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.InexactTokenTransfer.selector, "wrong refund error");
        require(feeToken.balanceOf(address(this)) == 10 ether, "fee transfer not reverted");
        _requireSessionCleared(feeMigrator.liquiditySession());
    }

    function testRejectsSenderPaidFeeThatOverDebitsOwner() public {
        ConsentSenderFeeToken feeToken = new ConsentSenderFeeToken();
        ConsentMockGovernance feeGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator feeMigrator,,, ConsentMockSushiV3PositionManager feeManager) =
            _deploy(weth, feeToken, feeGovernance);
        feeToken.setFeeSender(address(this));
        feeGovernance.unpause(feeMigrator);
        feeToken.mint(address(this), 11 ether);
        weth.mint(address(this), 10 ether);
        feeToken.approve(address(feeMigrator), 10 ether);
        weth.approve(address(feeMigrator), 10 ether);
        _setUsage(feeMigrator, feeManager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);

        (bool migrated, bytes memory reason) = _tryMigrate(feeMigrator, _request(feeMigrator, 10 ether, 10 ether));
        require(!migrated, "owner over-debit accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.InexactTokenTransfer.selector, "wrong debit error");
        require(feeToken.balanceOf(address(this)) == 11 ether, "sender fee not reverted");
        require(weth.balanceOf(address(this)) == 10 ether, "WETH transfer not reverted");
        require(feeMigrator.migrationNonces(address(this)) == 0, "failed nonce retained");
        _requireSessionCleared(feeMigrator.liquiditySession());
    }

    function testRejectsTokenThatPretendsToClearApproval() public {
        ConsentStickyApprovalToken stickyToken = new ConsentStickyApprovalToken();
        ConsentMockGovernance stickyGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator stickyMigrator,,, ConsentMockSushiV3PositionManager stickyManager) =
            _deploy(weth, stickyToken, stickyGovernance);
        stickyGovernance.unpause(stickyMigrator);
        _fundAndApprove(stickyMigrator, stickyToken, weth, 10 ether, 10 ether);
        _setUsage(stickyMigrator, stickyManager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);
        (bool migrated, bytes memory reason) = _tryMigrate(stickyMigrator, _request(stickyMigrator, 10 ether, 10 ether));
        require(!migrated, "sticky approval accepted");
        require(_selector(reason) == RMTConsentLiquiditySession.ApprovalNotCleared.selector, "wrong error");
        _requireSessionCleared(stickyMigrator.liquiditySession());
    }

    function testRechecksManagerApprovalsAfterRefundCallbacks() public {
        ConsentRefundApprovalToken hookToken = new ConsentRefundApprovalToken();
        ConsentMockGovernance hookGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator hookMigrator,,, ConsentMockSushiV3PositionManager hookManager) =
            _deploy(weth, hookToken, hookGovernance);
        hookToken.arm(address(hookMigrator.liquiditySession()), address(hookManager), address(this));
        hookGovernance.unpause(hookMigrator);
        _fundAndApprove(hookMigrator, hookToken, weth, 10 ether, 10 ether);
        _setUsage(hookMigrator, hookManager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);

        (bool migrated, bytes memory reason) = _tryMigrate(hookMigrator, _request(hookMigrator, 10 ether, 10 ether));
        require(!migrated, "refund callback restored approval");
        require(_selector(reason) == RMTConsentLiquiditySession.ApprovalNotCleared.selector, "wrong approval error");
        require(hookToken.balanceOf(address(this)) == 10 ether, "hook transfer not reverted");
        require(
            hookToken.allowance(address(hookMigrator.liquiditySession()), address(hookManager)) == 0,
            "hook approval not reverted"
        );
        _requireSessionCleared(hookMigrator.liquiditySession());
    }

    function testRechecksPositionOwnershipAfterRefundCallback() public {
        ConsentRefundHookToken hookToken = new ConsentRefundHookToken();
        ConsentMockGovernance hookGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator hookMigrator,,, ConsentMockSushiV3PositionManager hookManager) =
            _deploy(weth, hookToken, hookGovernance);
        hookGovernance.unpause(hookMigrator);
        hookToken.arm(address(hookManager), address(this), 1, address(0xBAD));
        _fundAndApprove(hookMigrator, hookToken, weth, 10 ether, 10 ether);
        _setUsage(hookMigrator, hookManager, 8 ether, 8 ether, 8 ether, 8 ether, 1_000 ether);

        (bool migrated, bytes memory reason) = _tryMigrate(hookMigrator, _request(hookMigrator, 10 ether, 10 ether));
        require(!migrated, "refund callback changed position owner");
        require(_selector(reason) == RMTConsentLiquiditySession.PositionVerificationFailed.selector, "wrong error");
        require(hookToken.balanceOf(address(this)) == 10 ether, "hook transfer not reverted");
        _requireSessionCleared(hookMigrator.liquiditySession());
    }

    function testBlocksTokenCallbackReentry() public {
        ConsentReentrantToken attackingToken = new ConsentReentrantToken();
        ConsentMockERC20 counterToken = new ConsentMockERC20();
        ConsentMockGovernance attackGovernance = new ConsentMockGovernance();
        (RMTConsentLiquidityMigrator attackMigrator,,, ConsentMockSushiV3PositionManager attackManager) =
            _deploy(counterToken, attackingToken, attackGovernance);
        attackGovernance.unpause(attackMigrator);
        attackingToken.arm(attackMigrator, counterToken);
        _fundAndApprove(attackMigrator, attackingToken, counterToken, 10 ether, 10 ether);
        _setUsage(attackMigrator, attackManager, 10 ether, 10 ether, 10 ether, 10 ether, 1_000 ether);

        attackMigrator.migrate(_request(attackMigrator, 10 ether, 10 ether));
        require(attackingToken.reentryAttempted(), "reentry not attempted");
        require(!attackingToken.reentrySucceeded(), "reentry succeeded");
        require(attackMigrator.migrationNonces(address(attackingToken)) == 0, "reentry nonce consumed");
        _requireSessionCleared(attackMigrator.liquiditySession());
    }

    function testPreservesUnsolicitedBalancesAndRejectsNativeCurrency() public {
        governance.unpause(migrator);
        RMTConsentLiquiditySession session = migrator.liquiditySession();
        pairedToken.mint(address(migrator), 3 ether);
        weth.mint(address(migrator), 2 ether);
        pairedToken.mint(address(session), 5 ether);
        weth.mint(address(session), 4 ether);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        migrator.migrate(_request(migrator, 10 ether, 10 ether));
        require(pairedToken.balanceOf(address(migrator)) == 3 ether, "paired gift consumed");
        require(weth.balanceOf(address(migrator)) == 2 ether, "WETH gift consumed");
        require(pairedToken.balanceOf(address(session)) == 5 ether, "session paired gift consumed");
        require(weth.balanceOf(address(session)) == 4 ether, "session WETH gift consumed");
        _requireSessionCleared(session);

        (bool sent,) = address(migrator).call{value: 1}("");
        require(!sent, "native currency accepted");
        (sent,) = address(session).call{value: 1}("");
        require(!sent, "session accepted native currency");
    }

    function testBindingBreakStopsEnableAndExecution() public {
        factory.breakBinding();
        (bool enabled,) = address(governance).call(abi.encodeWithSelector(governance.unpause.selector, migrator));
        require(!enabled, "enabled with broken binding");

        (RMTConsentLiquidityMigrator liveMigrator, ConsentMockSushiV3Factory liveFactory,,) =
            _deploy(weth, pairedToken, new ConsentMockGovernance());
        ConsentMockGovernance liveGovernance = ConsentMockGovernance(liveMigrator.governance());
        liveGovernance.unpause(liveMigrator);
        _fundAndApprove(liveMigrator, pairedToken, weth, 10 ether, 10 ether);
        liveFactory.breakBinding();
        (bool migrated,) = _tryMigrate(liveMigrator, _request(liveMigrator, 10 ether, 10 ether));
        require(!migrated, "migrated with broken binding");
    }

    function testRuntimeChainChangeStopsExecution() public {
        governance.unpause(migrator);
        _fundAndApprove(migrator, pairedToken, weth, 10 ether, 10 ether);
        vm.chainId(4_663);
        (bool migrated, bytes memory reason) = _tryMigrate(migrator, _request(migrator, 10 ether, 10 ether));
        vm.chainId(DESTINATION_CHAIN_ID);
        require(!migrated, "migrated on changed chain");
        require(
            _selector(reason) == RMTConsentLiquidityMigrator.ConfigurationIntegrityFailed.selector, "wrong chain error"
        );

        RMTConsentLiquiditySession session = migrator.liquiditySession();
        vm.chainId(4_663);
        vm.prank(address(migrator));
        (bool began, bytes memory beginReason) =
            address(session).call(abi.encodeWithSelector(session.begin.selector, address(this), keccak256("migration")));
        vm.chainId(DESTINATION_CHAIN_ID);
        require(!began, "session began on mainnet");
        require(_selector(beginReason) == RMTConsentLiquiditySession.WrongChain.selector, "wrong session chain error");
    }

    function testConstructorRejectsMainnetOrWrongChain() public {
        RMTConsentLiquidityMigrator.Configuration memory config =
            _configuration(weth, pairedToken, governance, factory, pool, manager, migrator.liquiditySession());
        vm.chainId(4_663);
        bool reverted;
        try new RMTConsentLiquiditySession(address(migrator), pairedToken, weth, manager, POOL_FEE) returns (
            RMTConsentLiquiditySession
        ) {}
        catch {
            reverted = true;
        }
        require(reverted, "session mainnet deployment accepted");

        reverted = false;
        try new RMTConsentLiquidityMigrator(config) returns (RMTConsentLiquidityMigrator) {}
        catch {
            reverted = true;
        }
        vm.chainId(DESTINATION_CHAIN_ID);
        require(reverted, "mainnet deployment accepted");
    }

    function _deploy(IERC20 weth_, IERC20 pairedToken_, ConsentMockGovernance governance_)
        private
        returns (
            RMTConsentLiquidityMigrator deployedMigrator,
            ConsentMockSushiV3Factory deployedFactory,
            ConsentMockSushiV3Pool deployedPool,
            ConsentMockSushiV3PositionManager deployedManager
        )
    {
        deployedFactory = new ConsentMockSushiV3Factory();
        address token0 = address(pairedToken_) < address(weth_) ? address(pairedToken_) : address(weth_);
        address token1 = address(pairedToken_) < address(weth_) ? address(weth_) : address(pairedToken_);
        deployedPool = new ConsentMockSushiV3Pool(address(deployedFactory), token0, token1, POOL_FEE, TICK_SPACING);
        deployedFactory.bindPool(address(deployedPool), token0, token1, POOL_FEE, TICK_SPACING);
        deployedManager = new ConsentMockSushiV3PositionManager(address(deployedFactory), address(weth_));

        uint256 nextNonce = uint256(vm.getNonce(address(this)));
        address expectedSession = vm.computeCreateAddress(address(this), nextNonce);
        address expectedMigrator = vm.computeCreateAddress(address(this), nextNonce + 1);
        RMTConsentLiquiditySession session =
            new RMTConsentLiquiditySession(expectedMigrator, pairedToken_, weth_, deployedManager, POOL_FEE);
        require(address(session) == expectedSession, "session address prediction");
        deployedMigrator = new RMTConsentLiquidityMigrator(
            _configuration(weth_, pairedToken_, governance_, deployedFactory, deployedPool, deployedManager, session)
        );
        require(address(deployedMigrator) == expectedMigrator, "migrator address prediction");
        require(session.router() == address(deployedMigrator), "session router binding");
    }

    function _configuration(
        IERC20 weth_,
        IERC20 pairedToken_,
        ConsentMockGovernance governance_,
        ConsentMockSushiV3Factory factory_,
        ConsentMockSushiV3Pool pool_,
        ConsentMockSushiV3PositionManager manager_,
        RMTConsentLiquiditySession session_
    ) private view returns (RMTConsentLiquidityMigrator.Configuration memory config) {
        config = RMTConsentLiquidityMigrator.Configuration({
            destinationChainId: DESTINATION_CHAIN_ID,
            governance: address(governance_),
            guardian: GUARDIAN,
            weth: weth_,
            pairedToken: pairedToken_,
            positionManager: manager_,
            factory: factory_,
            pool: pool_,
            session: session_,
            poolFee: POOL_FEE,
            positionManagerCodeHash: address(manager_).codehash,
            factoryCodeHash: address(factory_).codehash,
            poolCodeHash: address(pool_).codehash,
            sessionCodeHash: address(session_).codehash,
            wethCodeHash: address(weth_).codehash,
            pairedTokenCodeHash: address(pairedToken_).codehash,
            termsDocumentHash: TERMS_DOCUMENT_HASH
        });
    }

    function _request(RMTConsentLiquidityMigrator target, uint256 pairedDesired, uint256 wethDesired)
        private
        view
        returns (RMTConsentLiquidityMigrator.MigrationRequest memory request)
    {
        request = RMTConsentLiquidityMigrator.MigrationRequest({
            pairedTokenDesired: pairedDesired,
            wethDesired: wethDesired,
            pairedTokenMinimum: pairedDesired * 8 / 10,
            wethMinimum: wethDesired * 8 / 10,
            minimumLiquidity: 1,
            tickLower: -120,
            tickUpper: 120,
            deadline: block.timestamp + 10 minutes,
            acceptedTermsHash: target.migrationTermsHash()
        });
    }

    function _fundAndApprove(
        RMTConsentLiquidityMigrator target,
        ConsentMockERC20 pairedToken_,
        ConsentMockERC20 weth_,
        uint256 pairedAmount,
        uint256 wethAmount
    ) private {
        pairedToken_.mint(address(this), pairedAmount);
        weth_.mint(address(this), wethAmount);
        pairedToken_.approve(address(target), pairedAmount);
        weth_.approve(address(target), wethAmount);
    }

    function _setUsage(
        RMTConsentLiquidityMigrator target,
        ConsentMockSushiV3PositionManager manager_,
        uint256 pairedConsumed,
        uint256 wethConsumed,
        uint256 pairedReported,
        uint256 wethReported,
        uint128 liquidity
    ) private {
        bool pairedIsToken0 = target.pairedTokenIsToken0();
        manager_.setExecution(
            pairedIsToken0 ? pairedConsumed : wethConsumed,
            pairedIsToken0 ? wethConsumed : pairedConsumed,
            pairedIsToken0 ? pairedReported : wethReported,
            pairedIsToken0 ? wethReported : pairedReported,
            liquidity,
            address(0),
            0,
            false
        );
    }

    function _migrationId(
        RMTConsentLiquidityMigrator target,
        address owner,
        uint256 nonce,
        RMTConsentLiquidityMigrator.MigrationRequest memory request
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                target.MIGRATION_TYPEHASH(),
                block.chainid,
                address(target),
                owner,
                nonce,
                request.pairedTokenDesired,
                request.wethDesired,
                request.pairedTokenMinimum,
                request.wethMinimum,
                request.minimumLiquidity,
                request.tickLower,
                request.tickUpper,
                request.deadline,
                request.acceptedTermsHash
            )
        );
    }

    function _requireSessionCleared(RMTConsentLiquiditySession session) private view {
        require(session.activeMigrationId() == bytes32(0), "session migration retained");
        require(session.activeOwner() == address(0), "session owner retained");
        require(session.pairedTokenSessionBalanceBefore() == 0, "paired session snapshot retained");
        require(session.wethSessionBalanceBefore() == 0, "WETH session snapshot retained");
        require(session.pairedTokenOwnerBalanceBefore() == 0, "paired owner snapshot retained");
        require(session.wethOwnerBalanceBefore() == 0, "WETH owner snapshot retained");
    }

    function _requireDifferentMigrationId(
        bytes32 expected,
        RMTConsentLiquidityMigrator.MigrationRequest memory changed,
        string memory failureMessage
    ) private view {
        require(_migrationId(migrator, address(this), 0, changed) != expected, failureMessage);
    }

    function _tryMigrate(
        RMTConsentLiquidityMigrator target,
        RMTConsentLiquidityMigrator.MigrationRequest memory request
    ) private returns (bool migrated, bytes memory reason) {
        return address(target).call(abi.encodeWithSelector(target.migrate.selector, request));
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(reason, 32))
        }
    }
}
