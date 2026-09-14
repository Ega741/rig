// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {IPonsFactory, PonsGraduationPhase} from "../../src/interfaces/IPons.sol";

contract PonsTreasuryLaunchTest is PonsForkBase {
    function test_launch_registersTreasuryAsCreatorWithTwoPercentTax() public view {
        IPonsFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(address(token));
        assertEq(info.token, address(token));
        assertEq(info.curve, address(curve));
        assertEq(info.deployer, address(treasury));
        assertEq(info.creatorFeeRecipient, address(treasury));
        assertEq(info.creatorTaxBps, 200);
        assertFalse(info.buybackEnabled);
        assertEq(uint8(info.phase), uint8(PonsGraduationPhase.NotGraduated));
        assertEq(token.totalSupply(), 1e27);
    }

    function test_launch_deploysHashMineWithProductionParams() public view {
        assertEq(address(mine.token()), address(token));
        assertEq(mine.roundLength(), 600);
        assertEq(mine.releaseBps(), 48);
        assertEq(mine.targetShares(), 4096);
        assertEq(mine.minDifficultyFloor(), 20);
    }

    function test_launch_readsPonsDependenciesFromFactory() public view {
        assertEq(address(treasury.poolManager()), FACTORY.poolManager());
        assertEq(address(treasury.memeHook()), FACTORY.memeHook());
        assertEq(address(treasury.feeEscrow()), FACTORY.feeEscrow());
    }

    function test_launch_onlyOnce() public {
        PonsTreasury.LaunchInput memory input = _launchInput();
        uint256 fee = FACTORY.launchFee();
        vm.expectRevert(PonsTreasury.AlreadyLaunched.selector);
        treasury.launch{value: fee}(input);
    }

    function test_launch_onlyOwner() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY);
        PonsTreasury.LaunchInput memory input = _launchInput();
        uint256 fee = FACTORY.launchFee();
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", trader));
        fresh.launch{value: fee}(input);
    }
}
