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
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine, team, TEAM_BPS);
        vm.expectRevert(PonsTreasury.NotAdopted.selector);
        fresh.harvest();
    }

    function test_harvest_beforeAnyTrade_forwardsNothing() public {
        (uint256 toMiners, uint256 toTeam) = treasury.harvest();
        assertEq(toMiners, 0);
        assertEq(toTeam, 0);
        assertEq(address(mine).balance, 0);
    }

    function test_harvest_curve_splitsCreatorFees60to40() public {
        _curveBuy(1 ether);

        (uint256 toMiners, uint256 toTeam) = treasury.harvest();

        // A 1 ETH buy pays 3% creator tax + 70% of the 1% base fee = 0.037 ETH to the creator:
        // 60% to the team wallet, 40% to the miners.
        assertEq(toTeam, 0.0222 ether);
        assertEq(toMiners, 0.0148 ether);
        assertEq(team.balance, 0.0222 ether, "team wallet paid");
        assertEq(address(mine).balance, 0.0148 ether, "the rest reached HashMine");
        assertEq(mine.rewardPool(), 0.0148 ether, "and counts as pool");
        assertEq(address(treasury).balance, 0, "nothing stays in the treasury");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "escrow claimed");
    }

    function test_harvest_curve_everyTradeAddsToThePool() public {
        _curveBuy(1 ether);
        treasury.harvest();
        _curveBuy(1 ether);
        (uint256 toMiners, uint256 toTeam) = treasury.harvest();
        assertGt(toMiners, 0);
        assertEq(toTeam, toMiners * 3 / 2, "60/40");
        assertEq(address(mine).balance, 0.0148 ether + toMiners);
        assertEq(team.balance, 0.0222 ether + toTeam);
    }

    function test_harvest_anyoneCanCall() public {
        _curveBuy(1 ether);
        vm.prank(trader);
        (uint256 toMiners,) = treasury.harvest();
        assertEq(toMiners, 0.0148 ether);
    }

    function test_harvest_withoutTeamShare_forwardsEverythingToMiners() public {
        PonsTreasury all = new PonsTreasury(address(this), FACTORY, mine, address(0), 0);
        // The base setUp already routed the fees to `treasury`; only the current recipient may move them on.
        vm.prank(address(treasury));
        FACTORY.transferCreatorFeeRecipient(address(token), address(all));
        all.adopt(address(token));
        _curveBuy(1 ether);
        (uint256 toMiners, uint256 toTeam) = all.harvest();
        assertEq(toMiners, 0.037 ether);
        assertEq(toTeam, 0);
        assertEq(address(mine).balance, 0.037 ether);
    }

    function test_constructor_rejectsBadTeamShare() public {
        vm.expectRevert(PonsTreasury.BadTeamShare.selector);
        new PonsTreasury(address(this), FACTORY, mine, address(0), 6000);
        vm.expectRevert(PonsTreasury.BadTeamShare.selector);
        new PonsTreasury(address(this), FACTORY, mine, team, 10_001);
    }

    // ----------------------------------------------------------------- pool

    function test_harvest_pool_afterGraduation_forwardsGraduationEraFees() public {
        _graduate();
        (uint256 toMiners, uint256 toTeam) = treasury.harvest();
        assertGt(toMiners, 0, "graduation-era fees forwarded");
        assertEq(address(mine).balance, toMiners);
        assertEq(team.balance, toTeam);
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

        (uint256 toMiners,) = treasury.harvest();

        assertEq(hook.pendingCreatorTax(key.toId(), address(0)), 0, "treasury swept ETH tax itself");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "and claimed it");
        assertGt(toMiners, 0);
        assertEq(address(mine).balance, poolBefore + toMiners);
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
        (uint256 toMiners, uint256 toTeam) = treasury.harvest();
        assertEq(toMiners + toTeam, credited, "treasury claimed and split it");
        assertEq(address(mine).balance, poolBefore + toMiners);
    }
}
