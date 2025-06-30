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

export class SFeInfo extends BasicSoundBank
{
    /**
     * Initializes new SFe info parser and parses information.
     * @param arrayBuffer {ArrayBuffer}
     * @param warnDeprecated {boolean}
     */
    constructor(arrayBuffer, is64Bit = false)
    {
        super();
        this.dataArray = new IndexedByteArray(arrayBuffer);

        const header = readBytesAsString(this.dataArray, 4);
        if (header !== `ISFe`)
        {
            SpessaSynthWarn(`Unknown nested chunk: "${header}"`); // This should never happen.
        }
        let chunk;
        let text;
        let sfeVersion;
        while (this.dataArray.length > this.dataArray.currentIndex)
        {
            chunk = readRIFFChunk(this.dataArray, true, false, is64Bit);
            text = readBytesAsString(chunk.chunkData, chunk.chunkData.length);
            switch (chunk.header.toLowerCase())
            {
                case "sfty":
                    this.sfeInfo[chunk.header] = text;
                    switch (text)
                    {
                        case "SFe standard":
                            SpessaSynthInfo(
                                `%cSFe bank format: %cSFe Standard`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            break;
                        case "SFe standard with TSC":
                            SpessaSynthGroupEnd(`Banks with trailing sdta chunks are unsupported!`);
                            break;
                        default:
                            SpessaSynthWarn(`Unrecognised bank format: "${chunk.header}". Assuming "SFe standard"...`)
                    }
                    break;
                case "sfvx":
                    // this is awful code but readLittleEndian returns zero for some reason
                    // slicing the data somehow fixes this issue idk why
                    let sfeMajor = `${readLittleEndian(chunk.chunkData.slice(0,2),2)}`; 
                    let sfeMinor = `${readLittleEndian(chunk.chunkData.slice(2,4),2)}`;
                    let sfeSpecType = `${readBytesAsString(chunk.chunkData.slice(4,24),20)}`;
                    let sfeDraft = `${readLittleEndian(chunk.chunkData.slice(24,26),2)}`;
                    let sfeVerStr = `${readBytesAsString(chunk.chunkData.slice(26,46),20)}`;
                    this.sfeInfo[chunk.header + ".wSFeSpecMajorVersion"] = sfeMajor;
                    this.sfeInfo[chunk.header + ".wSFeSpecMinorVersion"] = sfeMinor;
                    this.sfeInfo[chunk.header + ".achSFeSpecType"] = sfeSpecType;
                    this.sfeInfo[chunk.header + ".wSFeDraftMilestone"] = sfeDraft;
                    this.sfeInfo[chunk.header + ".achSFeFullVersion"] = sfeVerStr;

                    sfeVersion = `${sfeMajor}.${sfeMinor}`
                    SpessaSynthInfo(
                        `%cSFe Version: %c${sfeVersion}`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    SpessaSynthInfo(
                        `%c"${chunk.header + ".achSFeSpecType"}": %c"${sfeSpecType}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    SpessaSynthInfo(
                        `%c"${chunk.header + ".wSFeDraftMilestone"}": %c"${sfeDraft}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    SpessaSynthInfo(
                        `%c"${chunk.header + ".achSFeFullVersion"}": %c"${sfeVerStr}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    break;
                case "flag":
                    // Todo: rewrite as a function similar to readModulators()
                    let flagIndex = 0;
                    let flagBranch;
                    let flagLeaf;
                    let flagFlags;
                    let flagWarn = false;
                    let endOfFlags = false;
                    let leafIndexArray = new Uint16Array(chunk.chunkData.length / 6);
                    while (flagIndex < chunk.chunkData.length)
                    {
                        // Access feature flags with this.sfeInfo[flag.<branch>.<leaf>] and use a bitwise AND operator for the desired flag(s).
                        flagBranch = `${readLittleEndian(chunk.chunkData.slice(flagIndex,flagIndex+1),1)}`; // branch
                        flagLeaf = `${readLittleEndian(chunk.chunkData.slice(flagIndex+1,flagIndex+2),1)}`; // leaf
                        flagFlags = `${readLittleEndian(chunk.chunkData.slice(flagIndex+2,flagIndex+6),1)}`; // flags (32 bits)
                        this.sfeInfo[chunk.header + "." + flagBranch + "." + flagLeaf] = flagFlags;
                        // This code assumes SFe 4.0 but will be changed for future versions.
                        leafIndexArray[flagIndex / 6] = 256 * parseInt(flagBranch) + parseInt(flagLeaf);
                        if ((parseInt(flagBranch) < 5))
                        {
                            SpessaSynthInfo(
                                `%c"${"Feature flags, branch " + flagBranch + " leaf " + flagLeaf}": %c"${flagFlags}"`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                        } else if ((parseInt(flagBranch) === 5) && (parseInt(flagLeaf) === 0))
                        {
                            endOfFlags = true;
                        } else if ((parseInt(flagBranch) < 240) && (flagWarn === false))
                        {
                            SpessaSynthWarn(`Undefined leaves ignored.`);
                            flagWarn = true;
                        } else if (parseInt(flagBranch) < 256)
                        {
                            SpessaSynthInfo(
                                `%c"${"Feature flags, private-use branch " + flagBranch + " leaf " + flagLeaf}": %c"${flagFlags}"`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                        }
                        flagIndex += 6; // Go to the next leaf of 32 flags
                    }
                    if (!endOfFlags)
                    {
                        SpessaSynthWarn(`The end of flags record was not found.`);
                    }
                    // Code to verify support for all functions required by the bank
                    // This should also be turned into a separate function in the future
                    for (const val in leafIndexArray)
                    {
                        flagBranch = leafIndexArray[val] >>> 8;
                        flagLeaf = leafIndexArray[val] & 255;
                        // Todo: Not hardcode the values to test against.
                        switch (parseInt(leafIndexArray[val]))
                        {
                            case 0: // tuning
                                this.verifyFlag(15,`${parseInt(this.sfeInfo[chunk.header + ".0.0"])}`,flagBranch,flagLeaf);
                                break;
                            case 1: // looping
                                this.verifyFlag(3,`${parseInt(this.sfeInfo[chunk.header + ".0.1"])}`,flagBranch,flagLeaf);
                                break;
                            case 2: // filter types
                                this.verifyFlag(1,`${parseInt(this.sfeInfo[chunk.header + ".0.2"])}`,flagBranch,flagLeaf);
                                break;
                            case 3: // filter params
                                this.verifyFlag(884736096,`${parseInt(this.sfeInfo[chunk.header + ".0.3"])}`,flagBranch,flagLeaf);
                                break;
                            case 4: // attenuation
                                this.verifyFlag(7,`${parseInt(this.sfeInfo[chunk.header + ".0.4"])}`,flagBranch,flagLeaf);
                                break;
                            case 5: // effects
                                this.verifyFlag(69391,`${parseInt(this.sfeInfo[chunk.header + ".0.5"])}`,flagBranch,flagLeaf);
                                break;
                            case 6: // LFO
                                this.verifyFlag(15,`${parseInt(this.sfeInfo[chunk.header + ".0.6"])}`,flagBranch,flagLeaf);
                                break;
                            case 7: // envelopes
                                this.verifyFlag(524287,`${parseInt(this.sfeInfo[chunk.header + ".0.7"])}`,flagBranch,flagLeaf);
                                break;
                            case 8: // MIDI CC
                                this.verifyFlag(231169,`${parseInt(this.sfeInfo[chunk.header + ".0.8"])}`,flagBranch,flagLeaf);
                                break;
                            case 9: // generators
                                this.verifyFlag(127,`${parseInt(this.sfeInfo[chunk.header + ".0.9"])}`,flagBranch,flagLeaf);
                                break;
                            case 10: // zones
                                this.verifyFlag(127,`${parseInt(this.sfeInfo[chunk.header + ".0.10"])}`,flagBranch,flagLeaf);
                                break;
                            case 11: // reserved
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".0.11"])}`,flagBranch,flagLeaf);
                                break;
                            case 256: // modulators
                                this.verifyFlag(16383,`${parseInt(this.sfeInfo[chunk.header + ".1.0"])}`,flagBranch,flagLeaf);
                                break;
                            case 257: // mod controllers
                                this.verifyFlag(51,`${parseInt(this.sfeInfo[chunk.header + ".1.1"])}`,flagBranch,flagLeaf);
                                break;
                            case 258: // mod params 1
                                this.verifyFlag(998838,`${parseInt(this.sfeInfo[chunk.header + ".1.2"])}`,flagBranch,flagLeaf);
                                break;
                            case 259: // mod params 2
                                this.verifyFlag(672137215,`${parseInt(this.sfeInfo[chunk.header + ".1.3"])}`,flagBranch,flagLeaf);
                                break;
                            case 260: // mod params 3
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".1.4"])}`,flagBranch,flagLeaf);
                                break;
                            case 261: // NRPN
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".1.5"])}`,flagBranch,flagLeaf);
                                break;
                            case 262: // default modulators
                                this.verifyFlag(263167,`${parseInt(this.sfeInfo[chunk.header + ".1.6"])}`,flagBranch,flagLeaf);
                                break;
                            case 263: // reserved
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".1.7"])}`,flagBranch,flagLeaf);
                                break;
                            case 264: // reserved
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".1.8"])}`,flagBranch,flagLeaf);
                                break;
                            case 512: // 24bit
                                this.verifyFlag(1,`${parseInt(this.sfeInfo[chunk.header + ".2.0"])}`,flagBranch,flagLeaf);
                                break;
                            case 513: // 8bit
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".2.1"])}`,flagBranch,flagLeaf);
                                break;
                            case 514: // 32bit
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".2.2"])}`,flagBranch,flagLeaf);
                                break;
                            case 515: // 64bit
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".2.3"])}`,flagBranch,flagLeaf);
                                break;
                            case 768: // SFe Compression
                                this.verifyFlag(1,`${parseInt(this.sfeInfo[chunk.header + ".3.0"])}`,flagBranch,flagLeaf);
                                break;
                            case 769: // compression formats
                                this.verifyFlag(1,`${parseInt(this.sfeInfo[chunk.header + ".3.1"])}`,flagBranch,flagLeaf);
                                break;
                            case 1024: // metadata
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".4.0"])}`,flagBranch,flagLeaf);
                                break;
                            case 1025: // reserved
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".4.1"])}`,flagBranch,flagLeaf);
                                break;
                            case 1026: // sample ROMs
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".4.2"])}`,flagBranch,flagLeaf);
                                break;
                            case 1027: // ROM emulator
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".4.3"])}`,flagBranch,flagLeaf);
                                break;
                            case 1028: // reserved
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".4.4"])}`,flagBranch,flagLeaf);
                                break;
                            case 1280: // end of flags
                                this.verifyFlag(0,`${parseInt(this.sfeInfo[chunk.header + ".5.0"])}`,flagBranch,flagLeaf);
                        }
                    }
                    break;
                default:
                    SpessaSynthWarn(`Unrecognised sub-chunk found in ISFe: ${chunk.header}`);
            }                
        }
    }




    /**
     * @param supported {uint32}
     * @param bankFlags {uint32}
     * @param branch {uint8}
     * @param leaf {uint8}
     */
    verifyFlag(supported, bankFlags, branch, leaf)
    {
        if (parseInt(supported & bankFlags) != bankFlags) // Using a strict inequality breaks this code.
        {
            SpessaSynthWarn(`Feature not fully supported at branch ${branch} leaf ${leaf}.`);
        }
    }

}

export function loadSFeInfo(buffer, is64Bit)
{
    return new SFeInfo(buffer, is64Bit);
}

    
