// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Exact-input ETH/token swaps for traders in fork tests.
contract PoolSwapper is IUnlockCallback {
    IPoolManager public immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    receive() external payable {}

    function buy(PoolKey memory key, address recipient) external payable returns (uint256 tokensOut) {
        tokensOut = abi.decode(manager.unlock(abi.encode(key, true, msg.value, recipient)), (uint256));
    }

    function sell(PoolKey memory key, uint256 tokensIn, address recipient) external returns (uint256 ethOut) {
        IERC20(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), tokensIn);
        ethOut = abi.decode(manager.unlock(abi.encode(key, false, tokensIn, recipient)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address recipient) =
            abi.decode(data, (PoolKey, bool, uint256, address));
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}),
            ""
        );
        if (zeroForOne) {
            manager.settle{value: uint256(uint128(-delta.amount0()))}();
            uint256 out = uint256(uint128(delta.amount1()));
            manager.take(key.currency1, recipient, out);
            return abi.encode(out);
        }
        uint256 paid = uint256(uint128(-delta.amount1()));
        manager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).transfer(address(manager), paid);
        manager.settle();
        uint256 ethOut = uint256(uint128(delta.amount0()));
        manager.take(key.currency0, recipient, ethOut);
        return abi.encode(ethOut);
    }
}
