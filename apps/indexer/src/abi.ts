import { parseAbiItem } from "viem";

export const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunchedV6(uint256 indexed launchId, address indexed token, address indexed creator, address market, address feeSplitter, bytes32 graduationPoolId, bytes32 policyId, uint32 policyVersion, uint16 curveFeeBps, uint16 creatorFeeShareBps, uint16 protocolFeeShareBps, uint16 postGraduationFeeBps, bool fairStartEnabled, uint64 fairStartDelayBlocks, uint64 fairStartDurationBlocks, uint16 fairStartMaxTxBps, uint16 fairStartMaxWalletBps, uint256 graduationTarget, bool officialMigration, string name, string symbol, string metadataURI)"
);

export const factoryReadAbi = [
  parseAbiItem("function protocolVersion() view returns (uint32)"),
  parseAbiItem("function creatorPayoutAuthority() view returns (address)")
] as const;

export const graduationAdapterReadAbi = [
  parseAbiItem("function factory() view returns (address)"),
  parseAbiItem("function poolFee() view returns (uint24)"),
  parseAbiItem("function markets(address token) view returns (address)"),
  parseAbiItem("function feeSplitters(address token) view returns (address)"),
  parseAbiItem("function postGraduationFeeBps(address token) view returns (uint16)")
] as const;

export const marketEvents = [
  parseAbiItem(
    "event Trade(address indexed trader, address indexed recipient, bool indexed isBuy, uint256 tokenAmount, uint256 ethAmount, uint256 feeAmount, uint256 virtualEthReserve, uint256 virtualTokenReserve, uint256 realEthReserve)"
  ),
  parseAbiItem("event Graduated(uint256 realEthReserve, uint256 tokenInventory)"),
  parseAbiItem(
    "event LiquidityMigrated(address indexed adapter, address indexed pool, uint256 ethAmount, uint256 tokenAmount, uint256 liquidity)"
  )
] as const;

export const feeSplitterEvents = [
  parseAbiItem(
    "event Initialized(address indexed creator, address indexed protocolTreasury, address indexed launchToken, uint16 creatorShareBps, address creatorPayoutAuthority, address authorizedMarket, address graduationAdapter)"
  ),
  parseAbiItem("event FeeReceived(address indexed payer, uint256 amount)"),
  parseAbiItem("event DirectPayment(address indexed recipient, uint256 amount)"),
  parseAbiItem("event PaymentDeferred(address indexed recipient, uint256 amount)"),
  parseAbiItem("event DeferredPaymentClaimed(address indexed recipient, uint256 amount)"),
  parseAbiItem("event TokenFeeReceived(address indexed payer, address indexed token, uint256 amount)"),
  parseAbiItem("event DirectTokenPayment(address indexed token, address indexed recipient, uint256 amount)"),
  parseAbiItem("event TokenPaymentDeferred(address indexed token, address indexed recipient, uint256 amount)"),
  parseAbiItem("event DeferredTokenPaymentClaimed(address indexed token, address indexed recipient, uint256 amount)"),
  parseAbiItem(
    "event CreatorWalletChanged(address indexed previousCreator, address indexed newCreator, address indexed authority, bytes32 evidenceHash, uint256 nonce)"
  ),
  parseAbiItem(
    "event CreatorPayoutNonceInvalidated(uint256 indexed previousNonce, uint256 indexed newNonce, address indexed protocolTreasury)"
  )
] as const;

export const graduationFeesCollectedEvent = parseAbiItem(
  "event GraduationFeesCollected(address indexed token, address indexed feeSplitter, uint256 nativeAmount, uint256 tokenAmount)"
);
