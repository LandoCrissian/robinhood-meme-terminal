# RMT Launch website review

Historical review for Task 027. The site was later published to www.rmtlaunch.fun. See the [Robinhood Chain discovery review](RMT_ROBINHOOD_CHAIN_DISCOVERY_REVIEW.md) for the new data paths and current indexer evidence.

The website-only branch starts at `main` commit `6d0b8103bdad95367445a38e5f5327458baa9ab2`. The interface comes from [draft #594](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/594) at `8dca5773cbd4dc98f52a45616f420bce96b000f0`. The new `apps/launch-website` Next.js package reuses the original brand artwork and shared styles from `apps/web`. Its only runtime dependencies are Next.js and React.

## Review site

Netlify Personal team `landon361` owns the isolated `eclectic-valkyrie-16cb92` project. The project has no Git link or custom domain. Use its manual draft context and identify the exact source commit in each deploy. The team has auto recharge disabled. The website uses no runtime environment variables, RPC, database, wallet provider, signer, server actions or transaction handler. Explicit middleware admits exact reviewed pages, static assets and a GET/HEAD configuration endpoint that reports execution disabled. Requests have no route into the existing terminal, API, MCP, administration or the private fixture. The application sends noindex headers and serves a disallow-all robots policy.

Use the repository root as the Netlify base, Node 22, pnpm 10.12.1, a frozen lockfile, the build command `pnpm --filter @rmt/launch-website build`, and publish `apps/launch-website/.next` with Netlify's Next.js adapter. The checked-in config fails production-context builds. Set no website secrets or production variables. Use a clean archive of the selected exact commit for draft uploads. The site's primary hostname should have no published deployment. [Netlify Next.js support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) · [Draft deploys](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/#draft-deploys)

Local review commands from repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website build
pnpm --filter @rmt/launch-website start --hostname 127.0.0.1 --port 3205
```

Run `node scripts/visual-qa/rmt-netlify-website.mjs` from another terminal. Set `RMT_WEBSITE_PREVIEW_URL` to the verified immutable HTTPS draft URL for hosted testing. The suite checks desktop, emulated iPhone portrait/landscape, direct links and refreshes, SSR and RSC, the disabled configuration endpoint, denied paths and methods, and wallet-provider activity.

## Website cutover requires owner approval

The existing `rmtlaunch.fun` redirects to `www.rmtlaunch.fun`, which is served by Vercel from `main` at `6d0b8103bdad95367445a38e5f5327458baa9ab2`. Vercel DNS provides the current records and Vercel serves the existing TLS certificate. Record the current DNS targets and Vercel deployment **before** a separately approved cutover. The existing root package and live Vercel app keep their existing entry point. The website branch ports the dependency and parser fixes needed by the shared lockfile so the legacy build can still use its existing source and authorization.

1. Approve the website-only PR and the intended Netlify production project. Review any changes to the site or error-page policy independently of contract approval.
2. Approve an explicit change to the production-only build override in `netlify.toml` for that project. Build the exact reviewed website commit under the same application settings. Test the resulting deployment and retain the read-only boundary.
3. In the approved Netlify project, add `www.rmtlaunch.fun` as primary and `rmtlaunch.fun` as the redirect. In the existing DNS provider, follow Netlify's project-specific DNS verification instructions. The usual records are a `www` CNAME to the approved Netlify hostname and an apex ALIAS to `apex-loadbalancer.netlify.com` or the A record Netlify specifies for providers without apex flattening. Preserve nameservers and unrelated records.
4. Verify both names have valid TLS and the apex redirects to the canonical hostname. Repeat route, wallet and transaction-negative tests on the approved target. Keep the prior Vercel deployment as a rollback target and restore its saved DNS records if needed. [Netlify external DNS instructions](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)

## Separate contract and owner acceptance

The proposal shown is 0.0004 ETH creation, 2 ETH candidate backing, 60/40 supply allocation, 1% curve trade fee and 90/5/5 accumulated fee shares. These are disclosures for fictional samples. The contracts, onchain balances and historical evidence were kept out of this deployment. The 18 active-engine and six escrow Slither findings, Foundry, fork, bounded symbolic checks and deployment-size evidence remain in the [exact #593 security handoff](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_CURVE_TASK025_VERIFICATION.md). Independent review and production infrastructure requirements remain open. The [private chain-31337 iPhone runbook](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/8dca5773cbd4dc98f52a45616f420bce96b000f0/docs/RMT_CURVE_TASK026_OWNER_ACCEPTANCE.md) describes a separate owner-operated MetaMask session.
