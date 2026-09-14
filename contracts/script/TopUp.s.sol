// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HashMine} from "../src/HashMine.sol";

/// @notice Testnet stand-in for creator fees: sends TOPUP_WEI of testnet ETH straight into the HashMine pool.
/// Any transfer to HashMine grows the pool.
/// Run: TOPUP_WEI=1000000000000000 forge script script/TopUp.s.sol:TopUp --rpc-url robinhood_testnet --broadcast
contract TopUp is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address payable mine = payable(vm.envAddress("HASHMINE_ADDRESS"));
        uint256 amount = vm.envOr("TOPUP_WEI", uint256(0.001 ether));
        vm.startBroadcast(key);
        (bool ok,) = mine.call{value: amount}("");
        require(ok, "topup");
        vm.stopBroadcast();
        console2.log("sent to pool (wei)", amount);
        console2.log("pool now (wei)", HashMine(mine).rewardPool());
    }
}
