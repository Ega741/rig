// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";

contract PonsTreasuryMigrationTest is PonsForkBase {
    address internal nextRecipient = makeAddr("nextRecipient");

    function test_migration_executesAfterDelayWithinWindow() public {
        treasury.proposeMigration(nextRecipient);
        uint256 eta = treasury.migrationEta();
        assertEq(eta, block.timestamp + 7 days);

        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.MigrationNotReady.selector, eta));
        treasury.executeMigration();

        vm.warp(eta);
        treasury.executeMigration();
        assertEq(FACTORY.getLaunchedToken(address(token)).creatorFeeRecipient, nextRecipient);
        assertEq(treasury.pendingRecipient(), address(0));
        assertEq(treasury.migrationEta(), 0);
    }

    function test_migration_expiresAfterWindow() public {
        treasury.proposeMigration(nextRecipient);
        uint256 eta = treasury.migrationEta();
        vm.warp(eta + 3 days + 1);
        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.MigrationExpired.selector, eta + 3 days));
        treasury.executeMigration();
    }

    function test_migration_cancelClearsProposal() public {
        treasury.proposeMigration(nextRecipient);
        treasury.cancelMigration();
        assertEq(treasury.pendingRecipient(), address(0));
        vm.expectRevert(PonsTreasury.NoPendingMigration.selector);
        treasury.executeMigration();
    }

    function test_migration_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", trader));
        treasury.proposeMigration(nextRecipient);
    }

    function test_migration_requiresAdoptedToken() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY, mine, team, TEAM_BPS);
        fresh.proposeMigration(nextRecipient);
        vm.warp(fresh.migrationEta());
        vm.expectRevert(PonsTreasury.NotAdopted.selector);
        fresh.executeMigration();
    }

    function test_migration_rejectsZeroRecipient() public {
        vm.expectRevert(PonsTreasury.ZeroAddress.selector);
        treasury.proposeMigration(address(0));
    }
}
