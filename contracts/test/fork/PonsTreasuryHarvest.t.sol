// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PonsForkBase} from "./PonsForkBase.sol";
import {PoolSwapper} from "./PoolSwapper.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {IPonsMemeHook} from "../../src/interfaces/IPons.sol";

contract PonsTreasuryHarvestTest is PonsForkBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ---------------------------------------------------------------- curve

    function test_harvest_beforeAnyTrade_buysNothing() public {
        (uint256 spent, uint256 tokensOut) = treasury.harvest();
        assertEq(spent, 0);
        assertEq(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), 0);
    }

    function test_harvest_tooSoon_reverts() public {
        treasury.harvest();
        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.HarvestTooSoon.selector, block.timestamp + 12));
        treasury.harvest();
    }

    function test_harvest_curve_claimsCreatorFeesAndBuysForHashMine() public {
        _curveBuy(1 ether);
        (uint256 quoteBefore, uint256 tokensBefore) = curve.getReserves();

        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertGt(spent, 0);
        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), tokensOut);
        // A 1 ETH buy pays 2% creator tax + 70% of the 1% base fee = 0.027 ETH to the treasury.
        assertEq(address(treasury).balance, 0.027 ether - spent);
        (uint256 quoteAfter, uint256 tokensAfter) = curve.getReserves();
        // Curve price quote/token moved by at most 1%.
        assertLe(quoteAfter * tokensBefore * 10_000, quoteBefore * tokensAfter * 10_100);
    }

    function test_harvest_curve_capsSpendAndLeavesRestForNextHarvest() public {
        _curveBuy(1 ether);
        (uint256 spent,) = treasury.harvest();
        uint256 left = address(treasury).balance;
        assertGt(left, 0, "cap left ETH for later");

        _nextHarvestWindow();
        (uint256 spent2, uint256 tokensOut2) = treasury.harvest();
        assertGt(spent2, 0);
        assertGt(tokensOut2, 0);
        // The second harvest also collected 2.7% of the first harvest's own buy.
        assertApproxEqAbs(address(treasury).balance, left + spent * 27 / 1000 - spent2, 3);
    }

    // ----------------------------------------------------------------- pool

    function _sqrtPrice(PoolKey memory key) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = treasury.poolManager().getSlot0(key.toId());
    }

    function test_harvest_pool_afterGraduation_buysWithinOnePercent() public {
        _graduate();
        PoolKey memory key = _poolKey();
        uint160 priceBefore = _sqrtPrice(key);

        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertGt(spent, 0, "graduation-era fees spent");
        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), tokensOut);
        // zeroForOne lowers sqrtPrice; floor is sqrt(0.99).
        assertGe(uint256(_sqrtPrice(key)) * 1_000_000, uint256(priceBefore) * 994_987);
    }

    function test_harvest_pool_sellFeesAreSweptWithoutOperator() public {
        _graduate();
        PoolKey memory key = _poolKey();
        IPonsMemeHook hook = treasury.memeHook();
        PoolSwapper swapper = new PoolSwapper(treasury.poolManager());
        uint256 tokensIn = token.balanceOf(trader) / 20;

        vm.startPrank(trader);
        token.approve(address(swapper), tokensIn);
        swapper.sell(key, tokensIn, trader);
        vm.stopPrank();
        assertGt(hook.pendingCreatorTax(key.toId(), address(0)), 0, "ETH tax pending after sell");
        assertEq(hook.pendingCreatorTax(key.toId(), address(token)), 0, "no memecoin tax pending");

        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertEq(hook.pendingCreatorTax(key.toId(), address(0)), 0, "treasury swept ETH tax itself");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "and claimed it");
        assertGt(spent, 0);
        assertEq(token.balanceOf(address(mine)), tokensOut);
    }

    function test_harvest_pool_buyFeesWaitForOperator() public {
        _graduate();
        treasury.harvest();
        PoolKey memory key = _poolKey();
        IPonsMemeHook hook = treasury.memeHook();
        PoolSwapper swapper = new PoolSwapper(treasury.poolManager());

        vm.prank(trader);
        swapper.buy{value: 1 ether}(key, trader);
        _nextHarvestWindow();
        treasury.harvest();
        assertGt(hook.pendingCreatorTax(key.toId(), address(token)), 0, "memecoin tax stays pending");

        vm.prank(hook.feeSweepOperator());
        // The deployed hook refuses a memecoin->ETH conversion without a non-zero output floor
        // (MinimumOutputRequired); the real operator always passes one.
        hook.sweepPoolFees(key.toId(), 1, 0);
        assertGt(treasury.feeEscrow().balanceOf(address(treasury)), 0, "operator credited ETH");

        _nextHarvestWindow();
        treasury.harvest();
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "treasury claimed it");
    }
}
