// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {IPonsFactory, PonsGraduationPhase} from "../../src/interfaces/IPons.sol";

contract PonsTreasuryAdoptTest is PonsForkBase {
    function test_adopt_bindsTheTokenWhoseFeesReachTheTreasury() public view {
        IPonsFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(address(token));
        assertEq(info.deployer, creator, "launched from the wallet");
        assertEq(info.creatorFeeRecipient, address(treasury), "fees routed to the treasury");
        assertEq(info.creatorTaxBps, 200);
        assertFalse(info.buybackEnabled);
        assertEq(uint8(info.phase), uint8(PonsGraduationPhase.NotGraduated));
        assertEq(treasury.token(), address(token));
        assertEq(treasury.curve(), address(curve));
    }

    function test_adopt_onlyOnce() public {
        vm.expectRevert(PonsTreasury.AlreadyAdopted.selector);
        treasury.adopt(address(token));
    }

    function test_adopt_rejectsTokenWhoseFeesGoElsewhere() public {
        address other = makeAddr("other");
        vm.deal(other, 1 ether);
        address otherToken = _launch(other, "Other", "OTH", keccak256("other-fork-test"));
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine);
        vm.expectRevert(PonsTreasury.NotFeeRecipient.selector);
        fresh.adopt(otherToken);
    }

    function test_adopt_rejectsUnknownToken() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine);
        vm.expectRevert(PonsTreasury.NotFeeRecipient.selector);
        fresh.adopt(makeAddr("not-a-launch"));
    }

    function test_adopt_onlyOwner() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", trader));
        fresh.adopt(address(token));
    }

    function test_hashMine_hasProductionParams() public view {
        assertEq(address(treasury.hashMine()), address(mine));
        assertEq(mine.roundLength(), 600);
        assertEq(mine.releaseBps(), 48);
        assertEq(mine.targetShares(), 4096);
        assertEq(mine.minDifficultyFloor(), 20);
    }

    function test_constructor_readsPonsDependenciesFromFactory() public view {
        assertEq(address(treasury.memeHook()), FACTORY.memeHook());
        assertEq(address(treasury.feeEscrow()), FACTORY.feeEscrow());
    }
}
