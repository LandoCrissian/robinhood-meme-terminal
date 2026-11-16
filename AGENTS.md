# RMT Launch repository instructions

RMT Launch is a dedicated Robinhood Chain token launchpad. Keep the existing UI, wallet review and transaction recovery. The product covers launch discovery, token creation, bonding-curve trading, locked Uniswap v4 graduation, and fee accounting with independent project treasuries.

Read [Architecture](docs/ARCHITECTURE.md), [Deployment](docs/DEPLOYMENT.md), [Security](docs/SECURITY.md) and [Creator treasuries](docs/CREATOR_TREASURIES.md) before changing those areas.

## Current decisions

- [Task 048A](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/627) narrows the repository to the launchpad. Legacy terminal, NFT marketplace, stock/RWA, social, game and agent product surfaces are outside this scope.
- [Task 049](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/626) follows the cleanup with a separately versioned candidate. The first RMT project will get a fresh token address. Every creation must have exactly 1,000,000,000 whole tokens with 18 decimals, fixed at creation by the contract. The current fixture predates this condition. Archived V4/V6 deployments have separate identities, balances and receipts.
- Keep legacy records and user assets intact. A historical address or event does not identify a new-engine project. Keep evidence and required shared compatibility separate from product scope. LAMMB operates independently. A project-specific treasury integration requires its own beneficiary authority.
- Keep proposed economics explicit. Curve fees and the original position's earned LP fees are split 90% project, 5% Operations and 5% Reserve. Only the project can choose its share's beneficiary allocation under committed terms. Initial liquidity principal is permanently locked.
- Keep exact chain, account, nonce, recipient, amount, full PoolKey, runtime and transaction binding. Use narrow approvals, explicit confirmation, simulation, verified settlement and duplicate prevention. Fail closed on missing or conflicting evidence. Background work never requests signatures or submits transactions. Keep credentials and wallet secrets private.
- Keep production read-only and `BLOCKED_NO_BROADCAST`. Deployment, funded acceptance and public activation require distinct approval. Preserve the security gate and independent review requirement. Synthetic tests, successful CI and repository cleanup cannot clear contract findings.
- Preserve approved production configuration, user data, deployed contract sources, manifests and receipts. Never infer authority to merge, provision paid services, sign, broadcast, publish, alter royalties, delete data or clean up remote branches.
- Prefer existing components and reproduce changes on isolated inputs. Run affected website, indexer, wallet and contract checks. Report the exact candidate, meaningful failures and evidence boundaries.

Issue-specific owner decisions govern forward scope. Git history and [retained evidence](docs/SECURITY.md) provide provenance. Earlier product directions and provisional terms do not override an explicit current decision.
