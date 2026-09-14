// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HashMine} from "../src/HashMine.sol";

/// @notice Local e2e deployment: a HashMine with short rounds and a low floor, seeded with 100 ETH.
/// Run: forge script script/DeployLocal.s.sol:DeployLocal --rpc-url <anvil> --broadcast --private-key <key>
contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast();
        HashMine mine = new HashMine(HashMine.Params({roundLength: 30, releaseBps: 48, targetShares: 64, minDifficulty: 8}));
        (bool ok,) = address(mine).call{value: 100 ether}("");
        require(ok, "seed");
        vm.stopBroadcast();
        console2.log("HASHMINE", address(mine));
    }
}
