// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "../test/utils/MockERC20.sol";

/// @notice Testnet stand-in for buybacks: mints TOPUP_TOKENS (whole tokens, default 10 000) of the mock
/// token straight into the HashMine pool. Any transfer to HashMine grows the pool.
/// Run: TOPUP_TOKENS=10000 forge script script/TopUp.s.sol:TopUp --rpc-url robinhood_testnet --broadcast
contract TopUp is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address mine = vm.envAddress("HASHMINE_ADDRESS");
        uint256 amount = vm.envOr("TOPUP_TOKENS", uint256(10_000)) * 1 ether;
        MockERC20 token = MockERC20(address(HashMine(mine).token()));
        vm.startBroadcast(key);
        token.mint(mine, amount);
        vm.stopBroadcast();
        console2.log("minted to pool", amount / 1 ether);
        console2.log("pool now", HashMine(mine).rewardPool() / 1 ether);
    }
}
