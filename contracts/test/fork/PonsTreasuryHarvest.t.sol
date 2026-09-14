// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PonsForkBase} from "./PonsForkBase.sol";
import {PoolSwapper} from "./PoolSwapper.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {IPonsMemeHook} from "../../src/interfaces/IPons.sol";

contract PonsTreasuryHarvestTest is PonsForkBase {
    using PoolIdLibrary for PoolKey;

    // ---------------------------------------------------------------- curve

    function test_harvest_beforeAdopt_reverts() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine);
        vm.expectRevert(PonsTreasury.NotAdopted.selector);
        fresh.harvest();
    }

    function test_harvest_beforeAnyTrade_forwardsNothing() public {
        assertEq(treasury.harvest(), 0);
        assertEq(address(mine).balance, 0);
    }

    function test_harvest_curve_forwardsCreatorFeesToHashMine() public {
        _curveBuy(1 ether);

        uint256 forwarded = treasury.harvest();

        // A 1 ETH buy pays 2% creator tax + 70% of the 1% base fee = 0.027 ETH to the creator.
        assertEq(forwarded, 0.027 ether);
        assertEq(address(mine).balance, 0.027 ether, "everything reached HashMine");
        assertEq(mine.rewardPool(), 0.027 ether, "and counts as pool");
        assertEq(address(treasury).balance, 0, "nothing stays in the treasury");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "escrow claimed");
    }

    function test_harvest_curve_everyTradeAddsToThePool() public {
        _curveBuy(1 ether);
        treasury.harvest();
        _curveBuy(1 ether);
        uint256 forwarded = treasury.harvest();
        assertGt(forwarded, 0);
        assertEq(address(mine).balance, 0.027 ether + forwarded);
    }

    function test_harvest_anyoneCanCall() public {
        _curveBuy(1 ether);
        vm.prank(trader);
        assertEq(treasury.harvest(), 0.027 ether);
    }

    // ----------------------------------------------------------------- pool

    function test_harvest_pool_afterGraduation_forwardsGraduationEraFees() public {
        _graduate();
        uint256 forwarded = treasury.harvest();
        assertGt(forwarded, 0, "graduation-era fees forwarded");
        assertEq(address(mine).balance, forwarded);
        assertEq(address(treasury).balance, 0);
    }

    function test_harvest_pool_sellFeesAreSweptWithoutOperator() public {
        _graduate();
        treasury.harvest();
        uint256 poolBefore = address(mine).balance;
        PoolKey memory key = _poolKey();
        IPonsMemeHook hook = treasury.memeHook();
        PoolSwapper swapper = new PoolSwapper(_poolManager());
        uint256 tokensIn = token.balanceOf(trader) / 20;

        vm.startPrank(trader);
        token.approve(address(swapper), tokensIn);
        swapper.sell(key, tokensIn, trader);
        vm.stopPrank();
        assertGt(hook.pendingCreatorTax(key.toId(), address(0)), 0, "ETH tax pending after sell");
        assertEq(hook.pendingCreatorTax(key.toId(), address(token)), 0, "no memecoin tax pending");

        uint256 forwarded = treasury.harvest();

        assertEq(hook.pendingCreatorTax(key.toId(), address(0)), 0, "treasury swept ETH tax itself");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "and claimed it");
        assertGt(forwarded, 0);
        assertEq(address(mine).balance, poolBefore + forwarded);
    }

    function test_harvest_pool_buyFeesWaitForOperator() public {
        _graduate();
        treasury.harvest();
        PoolKey memory key = _poolKey();
        IPonsMemeHook hook = treasury.memeHook();
        PoolSwapper swapper = new PoolSwapper(_poolManager());

        vm.prank(trader);
        swapper.buy{value: 1 ether}(key, trader);
        treasury.harvest();
        assertGt(hook.pendingCreatorTax(key.toId(), address(token)), 0, "memecoin tax stays pending");

        vm.prank(hook.feeSweepOperator());
        // The deployed hook refuses a memecoin->ETH conversion without a non-zero output floor
        // (MinimumOutputRequired); the real operator always passes one.
        hook.sweepPoolFees(key.toId(), 1, 0);
        uint256 credited = treasury.feeEscrow().balanceOf(address(treasury));
        assertGt(credited, 0, "operator credited ETH");

        uint256 poolBefore = address(mine).balance;
        uint256 forwarded = treasury.harvest();
        assertEq(forwarded, credited, "treasury claimed and forwarded it");
        assertEq(address(mine).balance, poolBefore + credited);
    }
}
