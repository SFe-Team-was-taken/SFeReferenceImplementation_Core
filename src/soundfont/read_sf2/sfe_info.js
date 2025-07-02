import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { readRIFFChunk } from "../basic_soundfont/riff_chunk.js";
import { consoleColors } from "../../utils/other.js";
import { SpessaSynthGroupEnd, SpessaSynthInfo, SpessaSynthWarn } from "../../utils/loggin.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import { BasicSoundBank } from "../basic_soundfont/basic_soundbank.js";

/**
 * sfe_info.js
 * a rough attempt at oop for isfe chunk parsing
 * many things need to be finished
 * right now it outputs an array in format (infoName, value)
 * 
 * planned functions:
 * readSFeType, readSFeVersionData, readSFeFlags, verifySFeFlags 
*/

export class SFeInfo
{
    /**
     * Initializes new SFe info parser and parses information.
     * @param arrayBuffer {ArrayBuffer}
     * @param is64Bit {boolean}
     * @param loadDefaults {boolean}
     */
    constructor(arrayBuffer, is64Bit = false, loadDefaults = false)
    {
        this.sfeInfo["SFty"] = "SFe-standard";
        this.sfeInfo["SFvx.wSFeSpecMajorVersion"] = 4;
        this.sfeInfo["SFvx.wSFeSpecMinorVersion"] = 0;
        this.sfeInfo["SFvx.achSFeSpecType"] = "Final";
        this.sfeInfo["SFvx.wSFeDraftMilestone"] = "0";
        this.sfeInfo["SFvx.achSFeFullVersion"] = "4.0u18";
        // Feature flag detection is not yet implemented.
        this.sfeInfo["flag.0.0"] = 0;
        this.sfeInfo["flag.0.1"] = 0;
        this.sfeInfo["flag.0.2"] = 0;
        this.sfeInfo["flag.0.3"] = 0;
        this.sfeInfo["flag.0.4"] = 0;
        this.sfeInfo["flag.0.5"] = 0;
        this.sfeInfo["flag.0.6"] = 0;
        this.sfeInfo["flag.0.7"] = 0;
        this.sfeInfo["flag.0.8"] = 0;
        this.sfeInfo["flag.0.9"] = 0;
        this.sfeInfo["flag.0.10"] = 0;
        this.sfeInfo["flag.0.11"] = 0;
        this.sfeInfo["flag.1.0"] = 0;
        this.sfeInfo["flag.1.1"] = 0;
        this.sfeInfo["flag.1.2"] = 0;
        this.sfeInfo["flag.1.3"] = 0;
        this.sfeInfo["flag.1.4"] = 0;
        this.sfeInfo["flag.1.5"] = 0;
        this.sfeInfo["flag.1.6"] = 0;
        this.sfeInfo["flag.1.7"] = 0;
        this.sfeInfo["flag.1.8"] = 0;
        this.sfeInfo["flag.2.0"] = 0;
        this.sfeInfo["flag.2.1"] = 0;
        this.sfeInfo["flag.2.2"] = 0;
        this.sfeInfo["flag.2.3"] = 0;
        this.sfeInfo["flag.3.0"] = 0;
        this.sfeInfo["flag.3.1"] = 0;
        this.sfeInfo["flag.4.0"] = 0;
        this.sfeInfo["flag.4.1"] = 0;
        this.sfeInfo["flag.4.2"] = 0;
        this.sfeInfo["flag.4.3"] = 0;
        this.sfeInfo["flag.4.4"] = 0;
        this.sfeInfo["flag.5.0"] = 0;
    }
}

/**
 * @param supported {uint32}
 * @param bankFlags {uint32}
 * @param branch {uint8}
 * @param leaf {uint8}
 */

export function verifyFlag(supported, bankFlags, branch, leaf)
{
    if (parseInt(supported & bankFlags) != bankFlags) // Using a strict inequality breaks this code.
    {
        SpessaSynthWarn(`Feature not fully supported at branch ${branch} leaf ${leaf}.`);
    }
}


export function loadSFeInfo(buffer, is64Bit, loadDefaults)
{
    return new SFeInfo(buffer, is64Bit, loadDefaults);
}

    
