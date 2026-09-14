// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "../test/utils/MockERC20.sol";

/// @notice Robinhood Chain testnet (46630): a mintable stand-in token and a HashMine with the production
/// round parameters (spec 5.1). PONS is not deployed on the testnet, so the pool is fed by TopUp.s.sol
/// instead of PonsTreasury.harvest().
/// Run: forge script script/DeployTestnet.s.sol:DeployTestnet --rpc-url robinhood_testnet --broadcast
contract DeployTestnet is Script {
    uint256 internal constant INITIAL_POOL = 1_000_000 ether;

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        vm.startBroadcast(key);
        MockERC20 token = new MockERC20();
        HashMine mine = new HashMine(
            IERC20(address(token)),
            HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4096, minDifficulty: 20})
        );
        token.mint(address(mine), INITIAL_POOL);
        vm.stopBroadcast();
        console2.log("TOKEN", address(token));
        console2.log("HASHMINE", address(mine));
        console2.log("POOL", INITIAL_POOL / 1 ether);
    }
}
