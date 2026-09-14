// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Brute-force nonce search for tests. Uses the exact hash layout of HashMine.submit.
library ShareFinder {
    function shareHash(address beneficiary, bytes32 challenge, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(beneficiary, challenge, nonce));
    }

    function leadingZeros(bytes32 h) internal pure returns (uint256 n) {
        uint256 x = uint256(h);
        if (x == 0) return 256;
        while (x >> 255 == 0) {
            x <<= 1;
            ++n;
        }
    }

    /// @notice `count` strictly increasing nonces greater than `from` with at least `difficulty` leading zero bits.
    function find(address beneficiary, bytes32 challenge, uint8 difficulty, uint256 from, uint256 count)
        internal
        pure
        returns (uint256[] memory nonces)
    {
        nonces = new uint256[](count);
        uint256 nonce = from;
        uint256 found;
        uint256 shift = 256 - difficulty;
        while (found < count) {
            ++nonce;
            if (uint256(shareHash(beneficiary, challenge, nonce)) >> shift == 0) nonces[found++] = nonce;
        }
    }

    /// @notice First nonce greater than `from` whose hash has exactly `zeros` leading zero bits.
    function findExact(address beneficiary, bytes32 challenge, uint256 zeros, uint256 from)
        internal
        pure
        returns (uint256 nonce)
    {
        nonce = from;
        while (true) {
            ++nonce;
            if (leadingZeros(shareHash(beneficiary, challenge, nonce)) == zeros) return nonce;
        }
    }
}
