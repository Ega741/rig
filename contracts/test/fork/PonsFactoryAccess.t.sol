// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";

/// @dev Documents who PONS lets move the creator-fee stream: the launch-day runbook depends on it.
contract PonsFactoryAccessTest is PonsForkBase {
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    function _launchWithSeparateRecipient() internal returns (address t) {
        address deployer = makeAddr("deployer2");
        vm.deal(deployer, 1 ether);
        // Same params as _launch, but the fee recipient is a different wallet than the deployer.
        t = _launch(deployer, "Access", "ACC", keccak256("access-fork-test"));
        vm.prank(deployer);
        FACTORY.transferCreatorFeeRecipient(t, recipient);
        assertEq(FACTORY.getLaunchedToken(t).creatorFeeRecipient, recipient);
    }

    function test_transfer_byCurrentRecipient() public {
        address t = _launchWithSeparateRecipient();
        vm.prank(recipient);
        FACTORY.transferCreatorFeeRecipient(t, address(treasury));
        assertEq(FACTORY.getLaunchedToken(t).creatorFeeRecipient, address(treasury), "recipient may transfer");
    }

    function test_transfer_byDeployerAfterRecipientChanged() public {
        address t = _launchWithSeparateRecipient();
        address deployer = FACTORY.getLaunchedToken(t).deployer;
        vm.prank(deployer);
        (bool ok,) = address(FACTORY).call(abi.encodeWithSelector(FACTORY.transferCreatorFeeRecipient.selector, t, address(treasury)));
        emit log_named_string("deployer (no longer recipient) may transfer", ok ? "yes" : "no");
    }

    function test_transfer_byStranger_reverts() public {
        address t = _launchWithSeparateRecipient();
        vm.prank(stranger);
        (bool ok,) = address(FACTORY).call(abi.encodeWithSelector(FACTORY.transferCreatorFeeRecipient.selector, t, address(treasury)));
        assertFalse(ok, "stranger cannot transfer");
    }
}
