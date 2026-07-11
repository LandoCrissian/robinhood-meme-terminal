// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

interface IERC20GraduationToken {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2Router02 {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

contract UniswapV2GraduationAdapter is IGraduationAdapter {
    address public constant LP_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IUniswapV2Factory public immutable factory;
    IUniswapV2Router02 public immutable router;
    address public immutable wrappedNative;

    bool private _entered;

    error ZeroAddress();
    error ExistingPool();
    error TokenTransferFailed();
    error InvalidLiquidityResult();
    error ReentrantCall();
    error UnauthorizedEthSender();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address factory_, address router_, address wrappedNative_) {
        if (factory_ == address(0) || router_ == address(0) || wrappedNative_ == address(0)) revert ZeroAddress();
        factory = IUniswapV2Factory(factory_);
        router = IUniswapV2Router02(router_);
        wrappedNative = wrappedNative_;
    }

    receive() external payable {
        if (msg.sender != address(router)) revert UnauthorizedEthSender();
    }

    function graduate(address token, uint256 tokenAmount)
        external
        payable
        nonReentrant
        returns (address pool, uint256 liquidity)
    {
        if (token == address(0) || tokenAmount == 0 || msg.value == 0) revert InvalidLiquidityResult();
        if (factory.getPair(token, wrappedNative) != address(0)) revert ExistingPool();

        IERC20GraduationToken graduationToken = IERC20GraduationToken(token);
        if (!graduationToken.transferFrom(msg.sender, address(this), tokenAmount)) revert TokenTransferFailed();
        if (!graduationToken.approve(address(router), tokenAmount)) revert TokenTransferFailed();

        (uint256 amountToken, uint256 amountEth, uint256 mintedLiquidity) = router.addLiquidityETH{value: msg.value}(
            token, tokenAmount, tokenAmount, msg.value, LP_BURN_ADDRESS, block.timestamp
        );

        pool = factory.getPair(token, wrappedNative);
        liquidity = mintedLiquidity;
        if (
            pool == address(0) || liquidity == 0 || amountToken != tokenAmount || amountEth != msg.value
                || graduationToken.balanceOf(address(this)) != 0 || address(this).balance != 0
        ) revert InvalidLiquidityResult();
    }
}
