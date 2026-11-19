// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SeaportAcquisitionTypes as T, IAcquisitionSeaport, IAcquisitionSignature, IAcquisitionToken, IAcquisition721, IAcquisition1155, IAcquisition165, IAcquisition2981, IAcquisitionCore, IAcquisitionCurve} from "./SeaportAcquisitionTypes.sol";
import {NftAcquisitionAccounts} from "../../nft-acquisition/src/NftAcquisitionAccounts.sol";
import {SeaportAcquisitionChecksV2} from "./SeaportAcquisitionChecksV2.sol";

/// @notice Separately funded, immutable, chain-31337-only Seaport custody candidate.
/// Enabling a policy grants bounded standing authority to any caller. The caller
/// pays gas; only previously accounted controller funding pays consideration.
/// No ledger claim, arbitrary executor, upgrade, proxy, delegatecall or NFT approval exists.
contract RMTSeaportAcquisitionVaultV2 {
    SeaportAcquisitionChecksV2 public immutable checks;
    bytes32 public immutable checksHash;
    address public immutable creator;
    address public immutable projectToken;
    bytes32 public immutable intentId;
    uint256 public immutable deploymentChainId;
    address public immutable coreFactory;
    bytes32 public immutable coreFactoryHash;
    bytes32 public immutable tokenRuntimeHash;
    address public immutable originCurve;
    address public immutable seaport;
    bytes32 public immutable seaportHash;
    bytes32 public immutable domainSeparator;
    address public immutable conduitController;
    bytes32 public immutable conduitControllerHash;
    address public immutable paymentToken;
    bytes32 public immutable paymentTokenHash;
    uint32 public constant periodSeconds = 1 days;
    uint48 public constant NOTICE = 2 days;
    uint48 public constant WINDOW = 7 days;
    uint256 private entered = 1;
    address public controller;
    uint64 public controllerEpoch = 1;
    uint64 public policyEpoch = 1;
    bool public purchasesEnabled;
    T.Policy public policy;
    uint48 public lastPurchaseAt;

    struct Collection { bytes32 runtimeHash; uint8 standard; bool enabled; bool anyTokenId; }
    struct ControllerNotice { address next; uint48 validAfter; uint48 expiresAt; uint64 epoch; }
    struct Withdrawal { uint8 kind; address asset; uint256 tokenId; uint256 quantity; address recipient; uint48 validAfter; uint48 expiresAt; uint64 epoch; uint8 state; }
    struct Settlement { address currency; uint256 total; uint256 oldCurrency; uint256 oldSeller; uint256 oldHeld; uint256[] recipientBalances; bytes32 royaltyHash; }
    mapping(address => Collection) public collections;
    mapping(address => uint256[]) private ids;
    mapping(address => mapping(uint256 => bool)) public allowedTokenId;
    address[] private admittedCollections;
    /// @dev Nonroyalty consideration recipients require explicit controller admission.
    mapping(address => uint16) public feeRecipientMaxBps;
    mapping(address => uint256) public accountedHeld;
    mapping(address => uint256) public reservedAsset;
    mapping(address => uint256) public funded;
    mapping(address => uint256) public withdrawn;
    mapping(address => uint256) public totalSpent;
    mapping(address => mapping(uint256 => uint256)) public periodSpent;
    mapping(address => mapping(uint256 => uint256)) public nftHeld;
    mapping(address => mapping(uint256 => uint256)) public nftReserved;
    mapping(address => bytes32) private custodyHash;
    mapping(address => uint8) private custodyStandard;
    mapping(bytes32 => bool) public orderConsumed;
    ControllerNotice public pendingController;
    mapping(uint64 => Withdrawal) public withdrawals;
    uint64 public withdrawalNonce;
    uint256 public pendingWithdrawals;
    bool private receiving;
    bool private received;
    address private expectedCollection;
    address private expectedSeller;
    uint256 private expectedId;
    uint256 private expectedQuantity;

    error Unauthorized(); error InvalidBinding(); error InvalidPolicy(); error InvalidOrder();
    error TransferFailed(); error ReentrantCall(); error InvalidNotice(); error UnexpectedNFT();
    event FundingReceived(address indexed currency,address indexed sender,uint256 amount,bytes32 source);
    event CollectionConfigured(address indexed collection,bytes32 runtimeHash,uint8 standard,bool enabled,bool anyTokenId,uint256[] ids,uint64 policyEpoch);
    event FeeRecipientConfigured(address indexed recipient,uint16 maxBps,uint64 policyEpoch);
    event PurchasePolicyChanged(uint64 indexed policyEpoch,uint64 controllerEpoch,bool enabled,address currency,uint128 perNftCap,uint128 totalBudget,uint128 periodBudget,uint32 cooldownSeconds);
    event PurchaseExecuted(bytes32 indexed orderHash,address indexed seller,address indexed collection,uint256 tokenId,uint256 quantity,address currency,uint256 totalCost,bytes32 considerationHash,uint256 counter,uint64 controllerEpoch,uint64 policyEpoch);
    event WithdrawalScheduled(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient,uint48 validAfter,uint48 expiresAt,uint64 epoch);
    event WithdrawalExecuted(uint64 indexed id,uint8 kind,address indexed asset,uint256 tokenId,uint256 quantity,address indexed recipient);
    event WithdrawalCancelled(uint64 indexed id);
    event ControllerProposed(address indexed next,uint48 validAfter,uint48 expiresAt,uint64 epoch);
    event ControllerChanged(address indexed previous,address indexed next,uint64 epoch);
    event ControllerCancelled(address indexed next,uint64 epoch);

    modifier guarded() { if (entered != 1) revert ReentrantCall(); _binding(); entered = 2; _; entered = 1; }
    modifier onlyController() { if (msg.sender != controller || !checks.supported(controller)) revert Unauthorized(); _; }

    constructor(address creator_,address token,address controller_,bytes32 intent,T.Pins memory p) {
        if (block.chainid != 31337 || creator_ == address(0) || intent == bytes32(0) || !NftAcquisitionAccounts.supported(controller_)
            || p.coreFactory.code.length == 0 || p.coreFactory.codehash != p.coreFactoryHash || p.coreFactoryHash == bytes32(0)
            || p.seaport.code.length == 0 || p.seaport.codehash != p.seaportHash || p.seaportHash == bytes32(0)
            || p.paymentToken.code.length == 0 || p.paymentToken.codehash != p.paymentTokenHash || p.paymentTokenHash == bytes32(0)
            || token.code.length == 0 || token.codehash != p.tokenRuntimeHash || p.tokenRuntimeHash == bytes32(0)) revert InvalidBinding();
        address curve = IAcquisitionCore(p.coreFactory).originCurveForToken(token);
        if (curve.code.length == 0 || IAcquisitionCurve(curve).creator() != creator_ || IAcquisitionCurve(curve).token() != token || IAcquisitionCurve(curve).factory() != p.coreFactory) revert InvalidBinding();
        (string memory version,bytes32 domain,address cc) = IAcquisitionSeaport(p.seaport).information();
        if (keccak256(bytes(version)) != keccak256("1.6") || cc.code.length == 0 || domain != keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("Seaport"),keccak256("1.6"),block.chainid,p.seaport))) revert InvalidBinding();
        checks = new SeaportAcquisitionChecksV2(); checksHash = address(checks).codehash;
        creator = creator_; projectToken = token; controller = controller_; intentId = intent; deploymentChainId = block.chainid;
        coreFactory = p.coreFactory; coreFactoryHash = p.coreFactoryHash; tokenRuntimeHash = p.tokenRuntimeHash; originCurve = curve;
        seaport = p.seaport; seaportHash = p.seaportHash; domainSeparator = domain; conduitController = cc; conduitControllerHash = cc.codehash;
        paymentToken = p.paymentToken; paymentTokenHash = p.paymentTokenHash;
    }

    function productionExecutionAvailable() external pure returns (bool) { return false; }
    function _binding() private view {
        if (address(checks).codehash != checksHash) revert InvalidBinding();
        checks.binding(address(this));
    }
    function _currency(address asset) private view { if (asset != address(0) && asset != paymentToken) revert InvalidPolicy(); }
    function _balance(address asset,address who) private view returns (uint256) { return asset == address(0) ? who.balance : IAcquisitionToken(asset).balanceOf(who); }
    function available(address asset) public view returns (uint256) { return accountedHeld[asset] - reservedAsset[asset]; }
    function collectionIds(address asset) external view returns (uint256[] memory) { return ids[asset]; }

    function fundNative(bytes32 source) external payable onlyController guarded {
        if (msg.value == 0 || source == bytes32(0)) revert InvalidPolicy();
        accountedHeld[address(0)] += msg.value; funded[address(0)] += msg.value;
        emit FundingReceived(address(0),msg.sender,msg.value,source);
    }
    function fundToken(uint256 amount,bytes32 source) external onlyController guarded {
        if (amount == 0 || source == bytes32(0)) revert InvalidPolicy();
        IAcquisitionToken t = IAcquisitionToken(paymentToken); uint256 a = t.balanceOf(address(this)); uint256 b = t.balanceOf(msg.sender);
        accountedHeld[paymentToken] += amount; funded[paymentToken] += amount;
        if (!t.transferFrom(msg.sender,address(this),amount) || t.balanceOf(address(this)) != a + amount || t.balanceOf(msg.sender) + amount != b) revert TransferFailed();
        emit FundingReceived(paymentToken,msg.sender,amount,source);
    }
    function configurePolicy(T.Policy calldata p,bool enabled) external onlyController guarded {
        _currency(p.currency);
        if (p.perNftCap == 0 || p.totalBudget < p.perNftCap || p.periodBudget < p.perNftCap || p.periodBudget > p.totalBudget || p.cooldownSeconds < 1
            || p.cooldownSeconds > 30 days || p.totalBudget < totalSpent[p.currency] || p.periodBudget < periodSpent[p.currency][block.timestamp / periodSeconds]) revert InvalidPolicy();
        policy = p; purchasesEnabled = enabled; policyEpoch++; _policyEvent();
    }
    function _policyEvent() private { T.Policy memory p = policy; emit PurchasePolicyChanged(policyEpoch,controllerEpoch,purchasesEnabled,p.currency,p.perNftCap,p.totalBudget,p.periodBudget,p.cooldownSeconds); }
    function disablePurchases() external onlyController guarded { purchasesEnabled = false; policyEpoch++; _policyEvent(); }
    function configureFeeRecipient(address recipient,uint16 maxBps) external onlyController guarded {
        if (purchasesEnabled || recipient == address(0) || recipient == address(this) || recipient == seaport || maxBps > 1000) revert InvalidPolicy();
        feeRecipientMaxBps[recipient] = maxBps; policyEpoch++; emit FeeRecipientConfigured(recipient,maxBps,policyEpoch);
    }
    function configureCollection(address asset,uint8 standard,bytes32 hash,bool enabled,bool any,uint256[] calldata selected) external onlyController guarded {
        checks.collection(asset,standard,hash);
        if (purchasesEnabled || selected.length > 32 || (!any && enabled && selected.length == 0)
            || (custodyHash[asset] != bytes32(0) && (custodyHash[asset] != hash || custodyStandard[asset] != standard))) revert InvalidPolicy();
        if (collections[asset].runtimeHash == bytes32(0)) { if (admittedCollections.length >= 8) revert InvalidPolicy(); admittedCollections.push(asset); }
        uint256[] memory old = ids[asset]; for (uint256 i; i < old.length; i++) delete allowedTokenId[asset][old[i]]; delete ids[asset];
        for (uint256 i; i < selected.length; i++) { if (i > 0 && selected[i] <= selected[i-1]) revert InvalidPolicy(); ids[asset].push(selected[i]); allowedTokenId[asset][selected[i]] = true; }
        collections[asset] = Collection(hash,standard,enabled,any); policyEpoch++;
        emit CollectionConfigured(asset,hash,standard,enabled,any,selected,policyEpoch);
    }
    function _nftBalance(address asset,uint8 standard,address who,uint256 id) private view returns (uint256) {
        return standard == 1 ? IAcquisition721(asset).balanceOf(who) : IAcquisition1155(asset).balanceOf(who,id);
    }
    function _admit(T.AdvancedOrder calldata a,T.Request calldata r,address currency) private view returns (uint256,uint256[] memory) {
        if (a.parameters.consideration.length > 10) revert InvalidOrder();
        uint16[] memory bps = new uint16[](a.parameters.consideration.length);
        for (uint256 i; i < bps.length; i++) bps[i] = feeRecipientMaxBps[a.parameters.consideration[i].recipient];
        return checks.admit(a,r,currency,address(this),seaport,domainSeparator,bps);
    }
    function purchase(T.AdvancedOrder calldata a,T.Request calldata r) external guarded {
        T.OrderParameters calldata o = a.parameters; T.Policy memory p = policy;
        if (!purchasesEnabled || !checks.supported(controller) || r.policyEpoch != policyEpoch || r.controllerEpoch != controllerEpoch
            || r.deadline < block.timestamp || r.deadline > block.timestamp + 5 minutes || o.offer.length != 1 || o.offerer == address(this) || o.offerer == address(0)
            || a.numerator != 1 || a.denominator != 1 || a.extraData.length != 0 || o.zone != address(0) || o.zoneHash != bytes32(0) || o.conduitKey != bytes32(0)
            || o.orderType != 0 || o.startTime > block.timestamp || o.endTime <= block.timestamp || o.endTime <= o.startTime) revert InvalidOrder();
        T.OfferItem calldata n = o.offer[0]; Collection memory c = collections[n.token];
        if (!c.enabled || n.token.codehash != c.runtimeHash || n.itemType != (c.standard == 1 ? 2 : 3) || n.startAmount == 0 || n.startAmount > 20
            || n.startAmount != n.endAmount || (c.standard == 1 && n.startAmount != 1) || (!c.anyTokenId && !allowedTokenId[n.token][n.identifierOrCriteria])) revert InvalidOrder();
        Settlement memory s; s.currency = p.currency;
        (s.total,s.recipientBalances) = _admit(a,r,s.currency);
        s.royaltyHash = checks.royalty(n.token,n.identifierOrCriteria,s.total);
        if (s.total > uint256(p.perNftCap) * n.startAmount || totalSpent[s.currency] + s.total > p.totalBudget
            || periodSpent[s.currency][block.timestamp / periodSeconds] + s.total > p.periodBudget || s.total > available(s.currency)
            || (lastPurchaseAt != 0 && block.timestamp < uint256(lastPurchaseAt) + p.cooldownSeconds)) revert InvalidOrder();
        bytes32 hash = r.signedOrderHash;
        if (orderConsumed[hash]) revert InvalidOrder();

        s.oldCurrency = _balance(s.currency,address(this)); s.oldSeller = _nftBalance(n.token,c.standard,o.offerer,n.identifierOrCriteria); s.oldHeld = _nftBalance(n.token,c.standard,address(this),n.identifierOrCriteria);
        if (s.oldCurrency < accountedHeld[s.currency] || s.oldSeller < n.startAmount || (c.standard == 1 && IAcquisition721(n.token).ownerOf(n.identifierOrCriteria) != o.offerer)) revert InvalidOrder();
        orderConsumed[hash] = true; accountedHeld[s.currency] -= s.total; totalSpent[s.currency] += s.total;
        periodSpent[s.currency][block.timestamp / periodSeconds] += s.total; lastPurchaseAt = uint48(block.timestamp);
        receiving = c.standard == 2; received = false; expectedCollection = n.token; expectedSeller = o.offerer; expectedId = n.identifierOrCriteria; expectedQuantity = n.startAmount;
        if (s.currency != address(0)) {
            IAcquisitionToken t = IAcquisitionToken(s.currency);
            if (t.allowance(address(this),seaport) != 0 || !t.approve(seaport,s.total) || t.allowance(address(this),seaport) != s.total) revert TransferFailed();
        }
        if (!IAcquisitionSeaport(seaport).fulfillAdvancedOrder{value:s.currency == address(0) ? s.total : 0}(a,new T.CriteriaResolver[](0),bytes32(0),address(this))) revert TransferFailed();
        receiving = false;
        if (s.currency != address(0)) { IAcquisitionToken t = IAcquisitionToken(s.currency); if (!t.approve(seaport,0) || t.allowance(address(this),seaport) != 0) revert TransferFailed(); }
        _binding(); checks.completed(seaport,o.offerer,hash,r.counter,domainSeparator,a.signature);
        if (!checks.supported(controller) || r.policyEpoch != policyEpoch || r.controllerEpoch != controllerEpoch || !purchasesEnabled
            || IAcquisitionSeaport(seaport).getCounter(o.offerer) != r.counter || n.token.codehash != c.runtimeHash || (c.standard == 2 && !received)
            || _balance(s.currency,address(this)) + s.total != s.oldCurrency || _nftBalance(n.token,c.standard,o.offerer,n.identifierOrCriteria) + n.startAmount != s.oldSeller
            || _nftBalance(n.token,c.standard,address(this),n.identifierOrCriteria) != s.oldHeld + n.startAmount
            || (c.standard == 1 && IAcquisition721(n.token).ownerOf(n.identifierOrCriteria) != address(this))) revert TransferFailed();
        if (checks.royalty(n.token,n.identifierOrCriteria,s.total) != s.royaltyHash) revert TransferFailed();
        for (uint256 i; i < o.consideration.length; i++) if (_balance(s.currency,o.consideration[i].recipient) != s.recipientBalances[i] + o.consideration[i].startAmount) revert TransferFailed();
        nftHeld[n.token][n.identifierOrCriteria] += n.startAmount; custodyHash[n.token] = c.runtimeHash; custodyStandard[n.token] = c.standard;
        emit PurchaseExecuted(hash,o.offerer,n.token,n.identifierOrCriteria,n.startAmount,s.currency,s.total,keccak256(abi.encode(o.consideration)),r.counter,controllerEpoch,policyEpoch);
        delete expectedCollection; delete expectedSeller; delete expectedId; delete expectedQuantity;
    }

    function _notice(uint48 expiry) private view returns (uint48 after_) { after_ = uint48(block.timestamp) + NOTICE; if (expiry <= after_ || expiry > after_ + WINDOW) revert InvalidNotice(); }
    function _queue(uint8 kind,address asset,uint256 id,uint256 quantity,address recipient,uint48 expiry) private returns (uint64 nonce) {
        if (quantity == 0 || recipient == address(0) || recipient == address(this) || recipient == seaport || pendingWithdrawals >= 16) revert InvalidNotice();
        uint48 after_ = _notice(expiry); nonce = ++withdrawalNonce; pendingWithdrawals++;
        withdrawals[nonce] = Withdrawal(kind,asset,id,quantity,recipient,after_,expiry,controllerEpoch,1);
        emit WithdrawalScheduled(nonce,kind,asset,id,quantity,recipient,after_,expiry,controllerEpoch);
    }
    function scheduleAssetWithdrawal(address asset,uint256 amount,address recipient,uint48 expiry) external onlyController guarded returns (uint64 id) {
        _currency(asset); if (amount > available(asset)) revert InvalidNotice(); id = _queue(0,asset,0,amount,recipient,expiry); reservedAsset[asset] += amount;
    }
    function scheduleNftWithdrawal(address asset,uint256 tokenId,uint256 quantity,address recipient,uint48 expiry) external onlyController guarded returns (uint64 id) {
        if (quantity > nftHeld[asset][tokenId] - nftReserved[asset][tokenId] || custodyHash[asset] != asset.codehash) revert InvalidNotice();
        id = _queue(custodyStandard[asset],asset,tokenId,quantity,recipient,expiry); nftReserved[asset][tokenId] += quantity;
    }
    function _release(Withdrawal memory w) private { if (w.kind == 0) reservedAsset[w.asset] -= w.quantity; else nftReserved[w.asset][w.tokenId] -= w.quantity; pendingWithdrawals--; }
    function cancelWithdrawal(uint64 id) external guarded {
        Withdrawal memory w = withdrawals[id]; if (w.state != 1 || (msg.sender != controller && w.epoch == controllerEpoch && block.timestamp <= w.expiresAt)) revert InvalidNotice();
        withdrawals[id].state = 3; _release(w); emit WithdrawalCancelled(id);
    }
    function executeWithdrawal(uint64 id) external guarded {
        Withdrawal memory w = withdrawals[id]; if (w.state != 1 || w.epoch != controllerEpoch || !checks.supported(controller) || block.timestamp < w.validAfter || block.timestamp > w.expiresAt) revert InvalidNotice();
        withdrawals[id].state = 2; _release(w);
        if (w.kind == 0) {
            accountedHeld[w.asset] -= w.quantity; withdrawn[w.asset] += w.quantity; uint256 a = _balance(w.asset,address(this)); uint256 b = _balance(w.asset,w.recipient);
            if (w.asset == address(0)) { (bool ok,) = payable(w.recipient).call{value:w.quantity}(""); if (!ok) revert TransferFailed(); }
            else if (!IAcquisitionToken(w.asset).transfer(w.recipient,w.quantity)) revert TransferFailed();
            if (_balance(w.asset,address(this)) + w.quantity != a || _balance(w.asset,w.recipient) != b + w.quantity) revert TransferFailed();
        } else {
            if (w.asset.codehash != custodyHash[w.asset]) revert InvalidBinding();
            uint256 a = _nftBalance(w.asset,w.kind,address(this),w.tokenId); uint256 b = _nftBalance(w.asset,w.kind,w.recipient,w.tokenId); nftHeld[w.asset][w.tokenId] -= w.quantity;
            if (w.kind == 1) IAcquisition721(w.asset).safeTransferFrom(address(this),w.recipient,w.tokenId);
            else IAcquisition1155(w.asset).safeTransferFrom(address(this),w.recipient,w.tokenId,w.quantity,"");
            if (_nftBalance(w.asset,w.kind,address(this),w.tokenId) + w.quantity != a || _nftBalance(w.asset,w.kind,w.recipient,w.tokenId) != b + w.quantity
                || (w.kind == 1 && IAcquisition721(w.asset).ownerOf(w.tokenId) != w.recipient)) revert TransferFailed();
        }
        _binding(); emit WithdrawalExecuted(id,w.kind,w.asset,w.tokenId,w.quantity,w.recipient);
    }
    function proposeController(address next,uint48 expiry) external onlyController guarded {
        if (pendingController.next != address(0) || next == controller || next == address(this) || !checks.supported(next)) revert InvalidNotice();
        uint48 after_ = _notice(expiry); pendingController = ControllerNotice(next,after_,expiry,controllerEpoch); emit ControllerProposed(next,after_,expiry,controllerEpoch);
    }
    function acceptController() external guarded {
        ControllerNotice memory n = pendingController;
        if (msg.sender != n.next || n.epoch != controllerEpoch || n.validAfter == 0 || block.timestamp < n.validAfter || block.timestamp > n.expiresAt || !checks.supported(msg.sender)) revert InvalidNotice();
        address previous = controller; controller = msg.sender; controllerEpoch++; policyEpoch++; purchasesEnabled = false; delete pendingController; emit ControllerChanged(previous,msg.sender,controllerEpoch);
    }
    function cancelController() external guarded {
        ControllerNotice memory n = pendingController; if (n.next == address(0) || (msg.sender != controller && n.epoch == controllerEpoch && block.timestamp <= n.expiresAt)) revert InvalidNotice();
        delete pendingController; emit ControllerCancelled(n.next,n.epoch);
    }
    /// @dev Seaport ERC721 delivery uses transferFrom. Never credit an unsolicited safe transfer.
    function onERC721Received(address,address,uint256,bytes calldata) external pure returns (bytes4) { revert UnexpectedNFT(); }
    function onERC1155Received(address operator,address from,uint256 id,uint256 quantity,bytes calldata data) external returns (bytes4) {
        if (entered != 2 || !receiving || received || msg.sender != expectedCollection || operator != seaport || from != expectedSeller || id != expectedId || quantity != expectedQuantity || data.length != 0) revert UnexpectedNFT();
        received = true; return 0xf23a6e61;
    }
    function onERC1155BatchReceived(address,address,uint256[] calldata,uint256[] calldata,bytes calldata) external pure returns (bytes4) { revert UnexpectedNFT(); }
    function supportsInterface(bytes4 id) external pure returns (bool) { return id == 0x01ffc9a7 || id == 0x150b7a02 || id == 0x4e2312e0; }
}
