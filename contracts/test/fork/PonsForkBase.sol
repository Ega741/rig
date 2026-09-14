// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {HashMine} from "../../src/HashMine.sol";
import {IPonsFactory, IPonsCurve, PonsGraduationPhase} from "../../src/interfaces/IPons.sol";

/// @dev The production flow against real PONS: a wallet launches the token on the PONS site, hands the
/// creator-fee stream to PonsTreasury, and the treasury is adopted to that token.
abstract contract PonsForkBase is Test {
    uint256 internal constant FORK_BLOCK = 62_704_000;
    IPonsFactory internal constant FACTORY = IPonsFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);

    PonsTreasury internal treasury;
    HashMine internal mine;
    IERC20 internal token;
    IPonsCurve internal curve;
    address internal creator = makeAddr("creator");
    address internal trader = makeAddr("trader");

    function setUp() public virtual {
        vm.createSelectFork("robinhood", FORK_BLOCK);
        mine = new HashMine(HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4096, minDifficulty: 20}));
        treasury = new PonsTreasury(address(this), FACTORY, mine);

        vm.deal(creator, 1 ether);
        token = IERC20(_launch(creator, "Rig Test", "RIGT", keccak256("rig-fork-test")));
        curve = IPonsCurve(FACTORY.getLaunchedToken(address(token)).curve);
        vm.prank(creator);
        FACTORY.transferCreatorFeeRecipient(address(token), address(treasury));
        treasury.adopt(address(token));

        vm.deal(trader, 100 ether);
        vm.warp(block.timestamp + 10); // past the 3 s snipe-tax window
    }

    /// @dev Launches from `who`'s wallet the way the PONS site does: `who` is deployer and fee recipient.
    function _launch(address who, string memory name, string memory symbol, bytes32 salt) internal returns (address token_) {
        IPonsFactory.TokenParams memory params = IPonsFactory.TokenParams({
            name: name,
            symbol: symbol,
            logo: "",
            description: "",
            socials: IPonsFactory.Socials("", "", "", "", ""),
            creatorFeeRecipient: who,
            creatorTaxBps: 200,
            buybackEnabled: false,
            expectedEconomics: FACTORY.previewLaunchEconomics(0, address(0)),
            salt: salt
        });
        uint256 fee = FACTORY.launchFee();
        vm.prank(who);
        (token_,) = FACTORY.launchToken{value: fee}(params, 0, address(0));
    }

    function _curveBuy(uint256 amount) internal returns (uint256 tokensOut) {
        vm.prank(trader);
        tokensOut = curve.buy{value: amount}(amount, 0, trader);
    }

    function _phase() internal view returns (PonsGraduationPhase) {
        return FACTORY.getLaunchedToken(address(token)).phase;
    }

    /// @dev Buys through the reserved allocation, then runs both graduation phases if auto-graduation did not.
    function _graduate() internal {
        _curveBuy(10 ether);
        if (_phase() == PonsGraduationPhase.NotGraduated) FACTORY.graduate(address(token));
        if (_phase() == PonsGraduationPhase.Swept) FACTORY.createGraduatedPool(address(token));
        assertEq(uint8(_phase()), uint8(PonsGraduationPhase.PoolCreated), "pool created");
    }

    function _poolManager() internal view returns (IPoolManager) {
        return IPoolManager(FACTORY.poolManager());
    }

    function _poolKey() internal view returns (PoolKey memory) {
        IPonsFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(address(token));
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: info.poolFee,
            tickSpacing: info.tickSpacing,
            hooks: IHooks(address(treasury.memeHook()))
        });
    }
}
