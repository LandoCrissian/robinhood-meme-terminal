// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable byte storage. The leading STOP makes all external calls
/// non-executing, regardless of opcodes present in the stored bytecode bytes.
/// The creating factory supplies slices of the exact compiled campaign code.
contract RMTReclaimCodePartV2 {
    error InvalidPart();
    constructor(bytes memory data){
        if(data.length==0||data.length>24_575)revert InvalidPart();
        bytes memory stored=bytes.concat(hex"00",data);
        assembly ("memory-safe") {return(add(stored,32),mload(stored))}
    }
}
