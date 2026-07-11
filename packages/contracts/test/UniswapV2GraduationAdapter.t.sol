// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedSupplyMemeToken} from "../src/FixedSupplyMemeToken.sol";
import {UniswapV2GraduationAdapter} from "../src/UniswapV2GraduationAdapter.sol";

interface AdapterTestVm {
    function deal(address account, uint256 balance) external;
}

contract MockV2Factory {
    address public pair;

    function getPair(address, address) external view returns (address) {
        return pair;
    }

    function setPair(address pair_) external {
        pair = pair_;
    }
}

contract MockV2Router {
    MockV2Factory private immutable factory;
    address private constant PAIR = address(0xBEEF);

    constructor(MockV2Factory factory_) {
        factory = factory_;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountEthMin,
        address recipient,
        uint256
    ) external payable returns (uint256 amountToken, uint256 amountEth, uint256 liquidity) {
        require(amountTokenMin == amountTokenDesired, "token minimum");
        require(amountEthMin == msg.value, "eth minimum");
        require(recipient == address(0x000000000000000000000000000000000000dEaD), "lp not burned");
        require(FixedSupplyMemeToken(token).transferFrom(msg.sender, PAIR, amountTokenDesired), "token transfer");
        factory.setPair(PAIR);
        return (amountTokenDesired, msg.value, amountTokenDesired);
    }
}

contract UniswapV2GraduationAdapterTest {
    AdapterTestVm private constant vm = AdapterTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockV2Factory private factory;
    MockV2Router private router;
    UniswapV2GraduationAdapter private adapter;
    FixedSupplyMemeToken private token;

    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 10 ether);
        factory = new MockV2Factory();
        router = new MockV2Router(factory);
        adapter = new UniswapV2GraduationAdapter(address(factory), address(router), address(0xCAFE));
        token = new FixedSupplyMemeToken("Graduate", "GRAD", 1_000_000 ether, address(this), address(this), "");
    }

    function testCreatesNewPoolAndBurnsAllLiquidity() public {
        uint256 tokenAmount = token.balanceOf(address(this));
        token.approve(address(adapter), tokenAmount);

        (address pool, uint256 liquidity) = adapter.graduate{value: 2 ether}(address(token), tokenAmount);

        require(pool == address(0xBEEF), "wrong pool");
        require(liquidity == tokenAmount, "wrong liquidity");
        require(token.balanceOf(address(adapter)) == 0, "adapter retained tokens");
        require(address(adapter).balance == 0, "adapter retained eth");
        require(address(router).balance == 2 ether, "router missing eth");
    }

    function testRejectsExistingPool() public {
        factory.setPair(address(0xBEEF));
        token.approve(address(adapter), token.balanceOf(address(this)));

        (bool success,) = address(adapter).call{value: 1 ether}(
            abi.encodeCall(adapter.graduate, (address(token), token.balanceOf(address(this))))
        );
        require(!success, "existing pool accepted");
    }
}
