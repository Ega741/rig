// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HashMine} from "../src/HashMine.sol";
import {PonsTreasury} from "../src/PonsTreasury.sol";
import {IPonsFactory} from "../src/interfaces/IPons.sol";

/// @notice Robinhood Chain mainnet (4663): HashMine with the production parameters (spec 5.1) and the
/// PonsTreasury that will receive the token's creator fees. Deploy BEFORE launching the token on PONS, then
/// launch from the owner wallet, transfer the creator-fee recipient to the treasury and call adopt(token).
/// Run: forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url robinhood_public --broadcast
contract DeployMainnet is Script {
    IPonsFactory internal constant FACTORY = IPonsFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);

    function run() external {
        uint256 key = vm.envUint("MAINNET_DEPLOYER_KEY");
        address owner = vm.envAddress("TREASURY_OWNER");
        vm.startBroadcast(key);
        HashMine mine = new HashMine(HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4096, minDifficulty: 20}));
        PonsTreasury treasury = new PonsTreasury(owner, FACTORY, mine);
        vm.stopBroadcast();
        console2.log("HASHMINE", address(mine));
        console2.log("TREASURY", address(treasury));
        console2.log("FEE_ESCROW", address(treasury.feeEscrow()));
        console2.log("OWNER", owner);
    }
}
