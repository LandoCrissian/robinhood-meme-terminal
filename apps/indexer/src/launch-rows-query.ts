const RECENT_WINDOW_LAST_BLOCK_OFFSET = 19_999n;
export const launchRowsSql = `WITH newest AS (
  SELECT
    token,
    ROW_NUMBER() OVER (ORDER BY block_number DESC, log_index DESC) AS signal_rank
  FROM launches
  WHERE protocol_version = 6
  ORDER BY block_number DESC, log_index DESC
  LIMIT $1
), moving AS (
  SELECT
    l.token,
    ROW_NUMBER() OVER (
      ORDER BY SUM(t.eth_amount) DESC, COUNT(*) DESC, MAX(t.block_number) DESC
    ) AS signal_rank
  FROM launches l
  JOIN trades t ON t.market = l.market AND t.block_number >= $2
  LEFT JOIN graduations g ON g.market = l.market
  WHERE l.protocol_version = 6 AND g.market IS NULL
  GROUP BY l.token
  ORDER BY SUM(t.eth_amount) DESC, COUNT(*) DESC, MAX(t.block_number) DESC
  LIMIT $1
), near_graduation AS (
  SELECT
    l.token,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(latest.real_eth_reserve, 0) DESC, l.block_number DESC, l.log_index DESC
    ) AS signal_rank
  FROM launches l
  LEFT JOIN graduations g ON g.market = l.market
  LEFT JOIN LATERAL (
    SELECT real_eth_reserve
    FROM trades t
    WHERE t.market = l.market
    ORDER BY block_number DESC, log_index DESC
    LIMIT 1
  ) latest ON TRUE
  WHERE l.protocol_version = 6 AND g.market IS NULL
  ORDER BY COALESCE(latest.real_eth_reserve, 0) DESC, l.block_number DESC, l.log_index DESC
  LIMIT $1
), candidates AS (
  SELECT token, MIN(signal_rank) AS signal_rank
  FROM (
    SELECT token, signal_rank FROM newest
    UNION ALL
    SELECT token, signal_rank FROM moving
    UNION ALL
    SELECT token, signal_rank FROM near_graduation
  ) signals
  GROUP BY token
), selected_candidates AS (
  SELECT token
  FROM candidates
  ORDER BY signal_rank ASC, token ASC
  LIMIT $3
)
SELECT
  l.*,
  COALESCE(stats.volume_wei, 0)::TEXT AS volume_wei,
  COALESCE(stats.trade_count, 0)::INTEGER AS trade_count,
  COALESCE(stats.buy_count, 0)::INTEGER AS buy_count,
  COALESCE(stats.sell_count, 0)::INTEGER AS sell_count,
  COALESCE(stats.creator_bought_tokens, 0)::TEXT AS creator_bought_tokens,
  COALESCE(stats.creator_sold_tokens, 0)::TEXT AS creator_sold_tokens,
  COALESCE(stats.creator_trade_count, 0)::INTEGER AS creator_trade_count,
  COALESCE(last_trade.real_eth_reserve, 0)::TEXT AS reserve_wei,
  (g.market IS NOT NULL) AS graduated,
  m.pool AS dex_pool,
  COALESCE(post_grad.native_fees, 0)::TEXT AS post_graduation_native_fees_collected,
  COALESCE(post_grad.token_fees, 0)::TEXT AS post_graduation_token_fees_collected,
  COALESCE(post_grad.collection_count, 0)::INTEGER AS post_graduation_collection_count
FROM launches l
JOIN selected_candidates candidate ON candidate.token = l.token
LEFT JOIN LATERAL (
  SELECT
    SUM(eth_amount) AS volume_wei,
    COUNT(*) AS trade_count,
    COUNT(*) FILTER (WHERE is_buy) AS buy_count,
    COUNT(*) FILTER (WHERE NOT is_buy) AS sell_count,
    SUM(token_amount) FILTER (WHERE t.trader = l.original_creator AND is_buy) AS creator_bought_tokens,
    SUM(token_amount) FILTER (WHERE t.trader = l.original_creator AND NOT is_buy) AS creator_sold_tokens,
    COUNT(*) FILTER (WHERE t.trader = l.original_creator) AS creator_trade_count
  FROM trades t
  WHERE t.market = l.market
    AND t.block_number >= $2
) stats ON TRUE
LEFT JOIN LATERAL (
  SELECT real_eth_reserve FROM trades t
  WHERE t.market = l.market
  ORDER BY block_number DESC, log_index DESC LIMIT 1
) last_trade ON TRUE
LEFT JOIN graduations g ON g.market = l.market
LEFT JOIN liquidity_migrations m ON m.market = l.market
LEFT JOIN LATERAL (
  SELECT
    SUM(native_amount) AS native_fees,
    SUM(token_amount) AS token_fees,
    COUNT(*) AS collection_count
  FROM graduation_fee_collections f
  WHERE f.token = l.token
) post_grad ON TRUE
WHERE l.protocol_version = 6
ORDER BY COALESCE(stats.volume_wei, 0) DESC, l.block_number DESC, l.log_index DESC`;

export function launchRowsQuery(indexedThrough: bigint, limit: number) {
  const recentFromBlock = indexedThrough > RECENT_WINDOW_LAST_BLOCK_OFFSET
    ? indexedThrough - RECENT_WINDOW_LAST_BLOCK_OFFSET
    : 0n;
  return {
    text: launchRowsSql,
    values: [limit, recentFromBlock.toString(), limit] as [number, string, number]
  };
}
