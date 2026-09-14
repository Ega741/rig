// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "../test/utils/MockERC20.sol";

/// @notice Local e2e deployment: a mintable token and a HashMine with short rounds and a low floor.
/// Run: forge script script/DeployLocal.s.sol:DeployLocal --rpc-url <anvil> --broadcast --private-key <key>
contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast();
        MockERC20 token = new MockERC20();
        HashMine mine = new HashMine(
            IERC20(address(token)), HashMine.Params({roundLength: 30, releaseBps: 48, targetShares: 64, minDifficulty: 8})
        );
        token.mint(address(mine), 1_000_000 ether);
        vm.stopBroadcast();
        console2.log("TOKEN", address(token));
        console2.log("HASHMINE", address(mine));
    }
}
