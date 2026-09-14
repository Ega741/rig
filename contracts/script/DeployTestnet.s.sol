// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HashMine} from "../src/HashMine.sol";

/// @notice Robinhood Chain testnet (46630): a HashMine with the production round parameters (spec 5.1),
/// seeded with SEED_WEI of testnet ETH. PONS is not deployed on the testnet, so the pool is fed by
/// TopUp.s.sol instead of PonsTreasury.harvest().
/// Run: SEED_WEI=3000000000000000 forge script script/DeployTestnet.s.sol:DeployTestnet --rpc-url robinhood_testnet --broadcast
contract DeployTestnet is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        uint256 seed = vm.envOr("SEED_WEI", uint256(0.003 ether));
        vm.startBroadcast(key);
        HashMine mine = new HashMine(HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4096, minDifficulty: 20}));
        (bool ok,) = address(mine).call{value: seed}("");
        require(ok, "seed");
        vm.stopBroadcast();
        console2.log("HASHMINE", address(mine));
        console2.log("POOL_WEI", seed);
    }
}
