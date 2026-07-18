// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RMTConsentLiquidityMigrator} from "../src/RMTConsentLiquidityMigrator.sol";
import {RMTConsentLiquiditySession} from "../src/RMTConsentLiquiditySession.sol";
import {RMTV6Governance} from "../src/RMTV6Governance.sol";
import {
    RMTTestnetSushiV3RehearsalFactory,
    RMTTestnetSushiV3RehearsalPool,
    RMTTestnetSushiV3RehearsalPositionManager,
    RMTTestnetSushiV3RehearsalToken,
    RMTTestnetSushiV3RehearsalVenue,
    RMTTestnetSushiV3ConsentStack
} from "../src/RMTTestnetSushiV3RehearsalStack.sol";

interface RMTRehearsalVm {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 balance) external;
    function getCode(string calldata artifactPath) external returns (bytes memory creationCode);
    function warp(uint256 newTimestamp) external;
}

contract RMTTestnetSushiV3RehearsalStackTest {
    RMTRehearsalVm private constant vm = RMTRehearsalVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant TESTNET_CHAIN_ID = 46_630;
    bytes32 private constant PINNED_TERMS_HASH = 0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57;
    string private constant TOKEN_ARTIFACT = "RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalToken";
    string private constant VENUE_ARTIFACT = "RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3RehearsalVenue";
    string private constant CONSENT_STACK_ARTIFACT =
        "RMTTestnetSushiV3RehearsalStack.sol:RMTTestnetSushiV3ConsentStack";

    RMTTestnetSushiV3RehearsalVenue private venue;
    RMTTestnetSushiV3ConsentStack private stack;

    function setUp() public {
        vm.chainId(TESTNET_CHAIN_ID);
        vm.deal(address(this), 1 ether);
        venue = RMTTestnetSushiV3RehearsalVenue(_deploy(_venueInitcode(address(this))));
        stack = RMTTestnetSushiV3ConsentStack(_deploy(_consentStackInitcode(address(this), venue)));
    }

    function testConstructorGuardsRobinhoodTestnetAndNonzeroOperator() public {
        vm.chainId(4_663);
        require(_tryDeploy(_venueInitcode(address(this))) == address(0), "stack accepted mainnet");

        bytes memory tokenInitcode =
            abi.encodePacked(vm.getCode(TOKEN_ARTIFACT), abi.encode("No Value", "NV", address(this), 1 ether));
        require(_tryDeploy(tokenInitcode) == address(0), "venue component accepted mainnet");

        vm.chainId(TESTNET_CHAIN_ID);
        require(_tryDeploy(_venueInitcode(address(0))) == address(0), "zero operator accepted");

        require(_tryDeploy(_consentStackInitcode(address(0xBEEF), venue)) == address(0), "mismatched operator accepted");
    }

    function testTopologyBindingsManifestAndInitialPause() public view {
        RMTTestnetSushiV3ConsentStack.Manifest memory manifest = stack.manifest();
        RMTTestnetSushiV3RehearsalFactory factory = stack.factory();
        RMTTestnetSushiV3RehearsalPool pool = stack.pool();
        RMTTestnetSushiV3RehearsalPositionManager manager = stack.positionManager();
        RMTConsentLiquiditySession session = stack.session();
        RMTConsentLiquidityMigrator migrator = stack.migrator();

        require(manifest.chainId == TESTNET_CHAIN_ID, "manifest chain");
        require(manifest.operator == address(this) && stack.operator() == address(this), "operator");
        require(manifest.venue == address(venue) && stack.venue() == venue, "venue manifest");
        require(manifest.guardian == address(this) && migrator.guardian() == address(this), "guardian");
        require(manifest.governance == address(stack.governance()), "governance manifest");
        require(manifest.pairedToken == address(stack.pairedToken()), "paired manifest");
        require(manifest.weth == address(stack.weth()), "WETH manifest");
        require(manifest.factory == address(factory), "factory manifest");
        require(manifest.pool == address(pool), "pool manifest");
        require(manifest.positionManager == address(manager), "manager manifest");
        require(manifest.session == address(session), "session manifest");
        require(manifest.migrator == address(migrator), "migrator manifest");
        require(manifest.poolFee == 3_000 && manifest.tickSpacing == 60, "pool policy");

        require(factory.pool() == pool, "factory pool");
        require(factory.getPool(factory.token0(), factory.token1(), 3_000) == address(pool), "factory forward binding");
        require(factory.getPool(factory.token1(), factory.token0(), 3_000) == address(pool), "factory reverse binding");
        require(factory.feeAmountTickSpacing(3_000) == 60, "fee spacing");
        require(pool.factory() == address(factory), "pool factory");
        require(pool.token0() == factory.token0() && pool.token1() == factory.token1(), "pool tokens");
        require(pool.fee() == 3_000 && pool.tickSpacing() == 60, "pool configuration");
        require(manager.factory() == address(factory), "manager factory");
        require(manager.WETH9() == address(stack.weth()), "manager WETH");
        require(manager.pool() == address(pool), "manager pool");

        require(session.router() == address(migrator), "session router");
        require(address(migrator.liquiditySession()) == address(session), "migrator session");
        require(address(migrator.sushiFactory()) == address(factory), "migrator factory");
        require(address(migrator.sushiPool()) == address(pool), "migrator pool");
        require(address(migrator.positionManager()) == address(manager), "migrator manager");
        require(migrator.governance() == address(stack.governance()), "migrator governance");
        require(migrator.paused(), "migrator not paused");

        require(manifest.pairedTokenCodeHash == address(stack.pairedToken()).codehash, "paired code hash");
        require(manifest.wethCodeHash == address(stack.weth()).codehash, "WETH code hash");
        require(manifest.venueCodeHash == address(venue).codehash, "venue code hash");
        require(manifest.governanceCodeHash == address(stack.governance()).codehash, "governance code hash");
        require(manifest.factoryCodeHash == address(factory).codehash, "factory code hash");
        require(manifest.poolCodeHash == address(pool).codehash, "pool code hash");
        require(manifest.positionManagerCodeHash == address(manager).codehash, "manager code hash");
        require(manifest.sessionCodeHash == address(session).codehash, "session code hash");
        require(manifest.migratorCodeHash == address(migrator).codehash, "migrator code hash");
        require(manifest.consentStackCodeHash == address(stack).codehash, "stack code hash");
        require(venue.runtimeCodeHash() == address(venue).codehash, "venue live code hash");
        require(stack.runtimeCodeHash() == address(stack).codehash, "stack live code hash");
        require(manifest.configurationHash == migrator.configurationHash(), "configuration hash");
        require(manifest.termsDocumentHash == PINNED_TERMS_HASH, "pinned terms hash");
        require(manifest.migrationTermsHash == migrator.migrationTermsHash(), "migration terms hash");
    }

    function testFixedSupplyValuelessTokensHaveNoPostConstructionMint() public {
        RMTTestnetSushiV3RehearsalToken paired = stack.pairedToken();
        RMTTestnetSushiV3RehearsalToken weth = stack.weth();

        require(paired.decimals() == 18 && weth.decimals() == 18, "decimals");
        require(paired.totalSupply() == stack.PAIRED_TOKEN_FIXED_SUPPLY(), "paired supply");
        require(weth.totalSupply() == stack.WETH_FIXED_SUPPLY(), "WETH supply");
        require(paired.balanceOf(address(this)) == paired.totalSupply(), "paired recipient");
        require(weth.balanceOf(address(this)) == weth.totalSupply(), "WETH recipient");
        require(paired.initialRecipient() == address(this) && weth.initialRecipient() == address(this), "recipient");

        (bool minted,) = address(paired).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        require(!minted, "paired token exposed mint");
        (minted,) = address(weth).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        require(!minted, "WETH token exposed mint");
        require(paired.totalSupply() == stack.PAIRED_TOKEN_FIXED_SUPPLY(), "paired supply changed");
        require(weth.totalSupply() == stack.WETH_FIXED_SUPPLY(), "WETH supply changed");
    }

    function testGovernanceDelayThenDirectSelfCustodiedMintAndExactAccounting() public {
        RMTV6Governance governance = stack.governance();
        RMTConsentLiquidityMigrator migrator = stack.migrator();
        RMTConsentLiquiditySession session = stack.session();
        RMTTestnetSushiV3RehearsalPositionManager manager = stack.positionManager();
        IERC20 paired = IERC20(address(stack.pairedToken()));
        IERC20 weth = IERC20(address(stack.weth()));

        require(governance.isSigner(address(this)), "operator not signer");
        require(governance.executionDelay() == 1 days, "governance delay");
        require(governance.executionWindow() == 7 days, "governance window");
        uint256 proposalId = governance.propose(address(migrator), 0, abi.encodeCall(migrator.unpause, ()));
        (bool early,) = address(governance).call(abi.encodeCall(governance.execute, (proposalId)));
        require(!early && migrator.paused(), "delay bypassed");
        vm.warp(block.timestamp + 1 days);
        governance.execute(proposalId);
        require(!migrator.paused(), "governance did not unpause");

        uint256 pairedDesired = 100 ether;
        uint256 wethDesired = 10 ether;
        uint256 pairedBefore = paired.balanceOf(address(this));
        uint256 wethBefore = weth.balanceOf(address(this));
        paired.approve(address(migrator), pairedDesired);
        weth.approve(address(migrator), wethDesired);

        RMTConsentLiquidityMigrator.MigrationRequest memory request = RMTConsentLiquidityMigrator.MigrationRequest({
            pairedTokenDesired: pairedDesired,
            wethDesired: wethDesired,
            pairedTokenMinimum: pairedDesired,
            wethMinimum: wethDesired,
            minimumLiquidity: uint128(wethDesired),
            tickLower: -120,
            tickUpper: 120,
            deadline: block.timestamp + 10 minutes,
            acceptedTermsHash: migrator.migrationTermsHash()
        });
        (, uint256 positionId, uint128 liquidity) = migrator.migrate(request);

        require(positionId == 1 && manager.totalSupply() == 1, "fresh NFT");
        require(manager.tokenByIndex(0) == positionId, "enumeration");
        require(manager.ownerOf(positionId) == address(this), "NFT recipient");
        require(liquidity == wethDesired, "rehearsal liquidity");
        require(paired.balanceOf(address(this)) == pairedBefore - pairedDesired, "paired accounting");
        require(weth.balanceOf(address(this)) == wethBefore - wethDesired, "WETH accounting");
        require(paired.balanceOf(address(stack.pool())) == pairedDesired, "paired pool receipt");
        require(weth.balanceOf(address(stack.pool())) == wethDesired, "WETH pool receipt");
        require(paired.balanceOf(address(migrator)) == 0 && weth.balanceOf(address(migrator)) == 0, "router custody");
        require(paired.balanceOf(address(session)) == 0 && weth.balanceOf(address(session)) == 0, "session custody");
        require(paired.allowance(address(session), address(manager)) == 0, "paired manager allowance");
        require(weth.allowance(address(session), address(manager)) == 0, "WETH manager allowance");
        require(paired.allowance(address(this), address(migrator)) == 0, "paired wallet allowance");
        require(weth.allowance(address(this), address(migrator)) == 0, "WETH wallet allowance");
        require(session.activeMigrationId() == bytes32(0) && session.activeOwner() == address(0), "session state");
    }

    function testVenueAndDeploymentShellExposeNoAdminMutationOrNativeReceiver() public {
        address[9] memory immutableSurfaces = [
            address(stack),
            address(venue),
            address(stack.pairedToken()),
            address(stack.weth()),
            address(stack.factory()),
            address(stack.pool()),
            address(stack.positionManager()),
            address(stack.session()),
            address(stack.migrator())
        ];

        bytes[5] memory forbiddenCalls = [
            abi.encodeWithSignature("upgradeTo(address)", address(this)),
            abi.encodeWithSignature("sweep(address,address)", address(stack.pairedToken()), address(this)),
            abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1),
            abi.encodeWithSignature("setPool(address)", address(this)),
            abi.encodeWithSignature("setFactory(address)", address(this))
        ];

        for (uint256 i; i < immutableSurfaces.length; ++i) {
            for (uint256 j; j < forbiddenCalls.length; ++j) {
                (bool mutated,) = immutableSurfaces[i].call(forbiddenCalls[j]);
                require(!mutated, "admin mutation surface accepted call");
            }
            (bool received,) = immutableSurfaces[i].call{value: 1}("");
            require(!received, "native currency accepted");
        }
    }

    function testSplitEncodedInitcodesRespectEip3860Limit() public {
        bytes memory venueInitcode = _venueInitcode(address(this));
        bytes memory stackInitcode = _consentStackInitcode(address(this), venue);
        require(venueInitcode.length < 49_152, "encoded venue initcode too large");
        require(stackInitcode.length < 49_152, "encoded stack initcode too large");
    }

    function _venueInitcode(address operator_) private returns (bytes memory) {
        return abi.encodePacked(vm.getCode(VENUE_ARTIFACT), abi.encode(operator_));
    }

    function _consentStackInitcode(address operator_, RMTTestnetSushiV3RehearsalVenue venue_)
        private
        returns (bytes memory)
    {
        return abi.encodePacked(vm.getCode(CONSENT_STACK_ARTIFACT), abi.encode(operator_, venue_));
    }

    function _deploy(bytes memory initcode) private returns (address deployed) {
        deployed = _tryDeploy(initcode);
        require(deployed != address(0), "artifact deployment failed");
    }

    function _tryDeploy(bytes memory initcode) private returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create(0, add(initcode, 0x20), mload(initcode))
        }
    }
}
