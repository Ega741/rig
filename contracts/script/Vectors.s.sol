// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Writes cross-implementation vectors for the share hash used by HashMine.submit:
/// keccak256(abi.encodePacked(beneficiary, challenge, nonce)), nonce = segment << 128 | worker << 64 | counter.
/// Run: forge script script/Vectors.s.sol:Vectors
contract Vectors is Script {
    uint256 internal constant COUNT = 12;

    function run() external {
        string memory json = "[";
        for (uint256 i = 0; i < COUNT; i++) {
            address beneficiary = address(uint160(uint256(keccak256(abi.encode("beneficiary", i)))));
            bytes32 challenge = keccak256(abi.encode("challenge", i));
            uint256 counter = uint64(uint256(keccak256(abi.encode("counter", i))));
            // The last four vectors are real shares of at least 12 bits.
            uint256 target = i < 8 ? 0 : 12;
            (uint256 nonce, bytes32 hash) = _find(beneficiary, challenge, i + 1, i % 4, counter, target);
            json = string.concat(json, i == 0 ? "" : ",", _entry(beneficiary, challenge, nonce, hash));
        }
        json = string.concat(json, "]");
        vm.writeFile("vectors/share-vectors.json", json);
    }

    function _find(address b, bytes32 c, uint256 segment, uint256 worker, uint256 counter, uint256 target)
        internal
        pure
        returns (uint256 nonce, bytes32 hash)
    {
        while (true) {
            nonce = (segment << 128) | (worker << 64) | counter;
            hash = keccak256(abi.encodePacked(b, c, nonce));
            if (_leadingZeroBits(hash) >= target) return (nonce, hash);
            counter = (counter + 1) & type(uint64).max;
        }
    }

    function _leadingZeroBits(bytes32 h) internal pure returns (uint256 n) {
        uint256 x = uint256(h);
        if (x == 0) return 256;
        while (x >> 255 == 0) {
            x <<= 1;
            ++n;
        }
    }

    function _entry(address b, bytes32 c, uint256 nonce, bytes32 hash) internal pure returns (string memory) {
        return string.concat(
            '{"beneficiary":"', vm.toString(b),
            '","challenge":"', vm.toString(c),
            '","nonce":"', vm.toString(nonce),
            '","hash":"', vm.toString(hash),
            '","leadingZeroBits":', vm.toString(_leadingZeroBits(hash)),
            "}"
        );
    }
}
