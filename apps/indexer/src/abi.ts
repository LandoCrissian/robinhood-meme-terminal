import { parseAbiItem } from "viem";

export const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunchedV6(uint256 indexed launchId, address indexed token, address indexed creator, address market, address feeSplitter, bytes32 graduationPoolId, bytes32 policyId, uint32 policyVersion, uint16 curveFeeBps, uint16 creatorFeeShareBps, uint16 protocolFeeShareBps, uint16 postGraduationFeeBps, bool fairStartEnabled, uint64 fairStartDelayBlocks, uint64 fairStartDurationBlocks, uint16 fairStartMaxTxBps, uint16 fairStartMaxWalletBps, uint256 graduationTarget, bool officialMigration, string name, string symbol, string metadataURI)"
);

export const marketEvents = [
  parseAbiItem(
    "event Trade(address indexed trader, address indexed recipient, bool indexed isBuy, uint256 tokenAmount, uint256 ethAmount, uint256 feeAmount, uint256 virtualEthReserve, uint256 virtualTokenReserve, uint256 realEthReserve)"
  ),
  parseAbiItem("event Graduated(uint256 realEthReserve, uint256 tokenInventory)"),
  parseAbiItem(
    "event LiquidityMigrated(address indexed adapter, address indexed pool, uint256 ethAmount, uint256 tokenAmount, uint256 liquidity)"
  )
] as const;
