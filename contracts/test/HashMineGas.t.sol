// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {ShareFinder} from "./utils/ShareFinder.sol";

/// @notice Execution gas of submit/claim, without intrinsic calldata cost. Numbers go to the plan report.
contract HashMineGasTest is Test {
    uint8 internal constant D = 4;
    MockERC20 internal token;
    HashMine internal mine;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockERC20();
        mine = new HashMine(
            IERC20(address(token)), HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4, minDifficulty: D})
        );
        token.mint(address(mine), 1e27);
    }

    function _measureSubmit(address who, uint256 count) internal returns (uint256 used) {
        uint256 round = mine.currentRound();
        HashMine.Miner memory m = mine.minerState(who);
        uint256 from = m.round == round ? m.lastNonce : 0;
        uint8 difficulty = mine.minDifficulty(round);
        uint256[] memory nonces = ShareFinder.find(who, mine.challenge(round), difficulty, from, count);
        uint256 before = gasleft();
        mine.submit(who, round, difficulty, nonces);
        used = before - gasleft();
    }

    function test_gas_report() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        emit log_named_uint("submit 1 share, first share ever (activates round 1)", _measureSubmit(a, 1));
        emit log_named_uint("submit 1 share, new miner, active round", _measureSubmit(b, 1));
        emit log_named_uint("submit 16 shares, same miner, same round", _measureSubmit(b, 16));
        emit log_named_uint("submit 64 shares, new miner, active round", _measureSubmit(c, 64));

        vm.warp(mine.roundStart(2));
        emit log_named_uint("submit 1 share, closes round 1 + settles miner", _measureSubmit(a, 1));

        vm.warp(mine.roundStart(3));
        uint256 before = gasleft();
        mine.claim(b);
        emit log_named_uint("claim (settle closed round + transfer)", before - gasleft());
    }
}
