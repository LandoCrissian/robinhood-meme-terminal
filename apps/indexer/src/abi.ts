import { parseAbiItem } from "viem";

export const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(uint256 indexed launchId, address indexed token, address indexed creator, address market, address rewardVault, bytes32 graduationPoolId, string name, string symbol, string metadataURI, uint16[5] rewardBps)"
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
