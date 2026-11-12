# Third-party notices

## Sushi V3 ABI compatibility

RMT includes independently authored minimal Solidity interfaces containing only the public function signatures and data shapes needed to interact with a Sushi V3 factory, pool, and non-fungible position manager. RMT does not vendor or modify Sushi's V3 implementation source or bytecode.

Compatibility was checked against Sushi's official [`v3-periphery`](https://github.com/sushiswap/v3-periphery) repository and [`INonfungiblePositionManager`](https://github.com/sushiswap/v3-periphery/blob/master/contracts/interfaces/INonfungiblePositionManager.sol). The upstream repository identifies its code under the [GNU General Public License v2.0](https://github.com/sushiswap/v3-periphery/blob/master/LICENSE), and individual interface files identify `GPL-2.0-or-later`. RMT's file headers do not alter or supersede those upstream terms; qualified counsel must determine the obligations for any particular distribution.

Before RMT vendors, copies, modifies, links, or redistributes any upstream implementation or generated artifact, the exact use and distribution plan must receive a license-compliance review and preserve all required notices and source rights.

## OpenZeppelin Contracts

The migration router imports `IERC20`, `SafeERC20`, and `ReentrancyGuard` from the project-pinned OpenZeppelin Contracts dependency. Preserve the dependency's license and notices whenever the contracts are redistributed.

## Zolva public API and MCP reference

RMT reviewed [Zolva commit `1ad8c29b6eaf162749742af95ec7f5fbc367608b`](https://github.com/zolvaagent/zolva/tree/1ad8c29b6eaf162749742af95ec7f5fbc367608b) for the separation of public response shaping, data reads and transport. The [upstream MIT license and copyright notice](third-party/ZOLVA-MIT.txt) are preserved here. RMT wrote its own launch-domain implementation. RMT includes no Zolva source, assets, names in its product UI, or branding.

RMT's MCP route imports `@modelcontextprotocol/sdk` version `1.32.2`, published under MIT, and uses the existing MIT-licensed `zod` dependency. Keep their package license files with redistributions. The MCP SDK and Zod package sources and license files are available from their upstream projects. [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Zod](https://github.com/colinhacks/zod).
