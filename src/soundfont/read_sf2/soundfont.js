import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readSamples } from "./samples.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { readGenerators } from "./generators.js";
import { applyPresetZones } from "./preset_zones.js";
import { readPresets } from "./presets.js";
import { readInstruments } from "./instruments.js";
import { readModulators } from "./modulators.js";
import { readRIFFChunk, RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { consoleColors } from "../../utils/other.js";
import { SpessaSynthGroup, SpessaSynthGroupEnd, SpessaSynthInfo, SpessaSynthWarn } from "../../utils/loggin.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import { stbvorbis } from "../../externals/stbvorbis_sync/stbvorbis_sync.min.js";
import { BasicSoundBank } from "../basic_soundfont/basic_soundbank.js";
import { Generator } from "../basic_soundfont/generator.js";
import { sf24DefaultModulators, sf21DefaultModulators, sfeDefaultModulators, Modulator } from "../basic_soundfont/modulator.js";
import { verifyFlag } from "./sfe_info.js";
import { applyInstrumentZones, InstrumentZone } from "./instrument_zones.js";
import { readZoneIndexes } from "./zones.js";

/**
 * soundfont.js
 * purpose: parses a soundfont2 (or sfe) file
 */

export class SoundFont2 extends BasicSoundBank
{
    /**
     * @type {Instrument[]}
     */
    instruments = [];
    
    /**
     * @type {Preset[]}
     */
    presets = [];
    
    /**
     * Initializes a new SoundFont2 Parser and parses the given data array
     * @param arrayBuffer {ArrayBuffer}
     * @param warnDeprecated {boolean}
     */
    constructor(arrayBuffer, warnDeprecated = true)
    {
        super();
        if (warnDeprecated)
        {
            console.warn("Using the constructor directly is deprecated. Use loadSoundFont instead.");
        }
        const mainFileArray = new IndexedByteArray(arrayBuffer);
        SpessaSynthGroup("%cParsing SoundFont...", consoleColors.info);
        if (!mainFileArray)
        {
            SpessaSynthGroupEnd();
            this.parsingError("No data provided!");
        }
        
        // Get header first
        const firstFourCC = new IndexedByteArray(mainFileArray.slice(0,4));
        let firstFourCCString = readBytesAsString(firstFourCC, 4);
        let is64Bit;
        let chunkBacktrack;
        let isfePresent = false;

        switch (firstFourCCString.toLowerCase())
        {
            case "riff":
                is64Bit = false;
                chunkBacktrack = 12;
                break;
            case "rifs":
                is64Bit = true;
                chunkBacktrack = 16;
                break;
            default:
                SpessaSynthGroupEnd();
                this.parsingError(`Invalid chunk header! Expected "riff" or "rifs" got "${firstFourCCString}"`);
        }

        // read the main read
        let firstChunk = readRIFFChunk(mainFileArray, false, false, is64Bit);
        const firstHeader = firstChunk.header.toLowerCase();

        const type = readBytesAsString(mainFileArray, 4).toLowerCase();
        if (type !== "sfbk" && type !== "sfpk" && type !== "sfen")
        {
            SpessaSynthGroupEnd();
            throw new SyntaxError(`Invalid soundFont! Expected "sfbk", "sfpk" or "sfen" got "${type}"`);
        }
        /*
        Some SF2Pack description:
        this is essentially sf2, but the entire smpl chunk is compressed (we only support Ogg Vorbis here)
        and the only other difference is that the main chunk isn't "sfbk" but rather "sfpk"
         */
        
        let bankType = "invalid";
        switch (firstHeader)
        {
            case "riff":
                switch (type)
                {
                    case "sfbk":
                        bankType = "sf2";
                        break;
                    case "sfpk":
                        bankType = "sf2pack";
                        break;
                    case "sfen":
                        bankType = "sfe32";
                }
                break;
            case "rifs":
                switch (type)
                {
                    // 64-bit chunk headers can only be used with SFe.
                    case "sfen":
                        bankType = "sfe64";
                        SpessaSynthInfo("64-bit mode enabled! Aw yeah!!!");
                }
                break;
        }
        const isSF2Pack = bankType === "sf2pack";

        if (bankType === "invalid")
        {
            SpessaSynthGroupEnd();
            this.parsingError(`Invalid bank type: "${firstHeader}" and "${type}"`);
        }
        
        // INFO
        let infoChunk = readRIFFChunk(mainFileArray, true, false, is64Bit);
        this.verifyHeader(infoChunk, "list");
        const infoString = readBytesAsString(infoChunk.chunkData, 4);
        if (infoString !== "INFO")
        {
            SpessaSynthGroupEnd();
            throw new SyntaxError(`Invalid soundFont! Expected "INFO" or "${infoString}"`);
        }
        
        /**
         * @type {RiffChunk|undefined}
         */
        let xdtaChunk = undefined;
        
        
        while (infoChunk.chunkData.length > infoChunk.chunkData.currentIndex)
        {
            let chunk = readRIFFChunk(infoChunk.chunkData, true, false, is64Bit);
            let text;
            let sfeVersion;
            // special cases
            switch (chunk.header.toLowerCase())
            {
                case "ifil":
                case "iver":
                    const wMajor = `${readLittleEndian(chunk.chunkData, 2)}`
                    const wMinor = `${readLittleEndian(chunk.chunkData, 2)}`
                    // Legacy code for combined ifil/iver value representation
                    // Separated values are useful for implementation of SFe
                    text = `${wMajor}.${wMinor}`;
                    this.soundFontInfo[chunk.header] = text;
                    this.soundFontInfo[chunk.header + ".wMajor"] = wMajor;
                    this.soundFontInfo[chunk.header + ".wMinor"] = wMinor;
                    SpessaSynthInfo(
                        `%c"${chunk.header}": %c"${text}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    if (chunk.header.toLowerCase() === "ifil")
                    {
                        switch (wMajor)
                        {
                            case `4`:
                                if (bankType === "sfe64")
                                {
                                    sfeVersion = text;
                                } else {
                                    SpessaSynthWarn(`Bank version not fully supported: "${text}"`)
                                }
                                break;
                            case `3`:
                            case `2`:
                                if (wMinor >= 1024)
                                {
                                    // Load the highest SFe version for the ifil.wMinor value.
                                    // SFvx data is used to determine the precise version. 
                                    // If SFvx data is invalid, then sfeVersion falls back to this value.
                                    sfeVersion = `4.0`; // Highest SFe version with ifil.wMinor=1024 is 4.0 (for now).
                                } else {
                                    sfeVersion = text;
                                    if (sfeVersion = `2.04`)
                                    {
                                        this.defaultModulators = sf24DefaultModulators.map(m => Modulator.copy(m));
                                    } else if (sfeVersion = `2.01`)
                                    {
                                        this.defaultModulators = sf24DefaultModulators.map(m => Modulator.copy(m));
                                    }
                                }
                                switch (bankType)
                                {
                                    case `sfe64`:
                                        SpessaSynthWarn(`Banks using 64-bit chunk headers use the specification version in ifil.`);
                                        break;
                                    case `sfe32`:
                                        if (wMajor === 2)
                                        {
                                            SpessaSynthWarn(`Non-containerised SFe banks are deprecated.`);
                                        }
                                        break;
                                }

                                break;
                            case `1`:
                                // We don't know the structure of an SBK file, but we assume that wMajor=1 in that case.
                                SpessaSynthGroupEnd(`.SBK files are not currently supported.`)
                                break;
                            default:
                                SpessaSynthWarn(`Bank version not fully supported: "${text}"`)
                                break;
                        }
                    }
                    break;
                case "isng":
                    text = readBytesAsString(chunk.chunkData, chunk.chunkData.length, undefined, false);
                    this.soundFontInfo[chunk.header] = text;

                    switch (text)
                    {
                        case "EMU8000":
                            SpessaSynthInfo(
                                `%cSynthesis engine: %cAWE32/AWE64 (EMU8000)`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            if (bankType === "sfe32" || bankType === "sfe64")
                            {
                                SpessaSynthWarn(`Legacy synthesis engines are deprecated.`);
                            } 
                            break;
                        case "E-mu 10K1":
                            SpessaSynthInfo(
                                `%cSynthesis engine: %cSB Live! (EMU10K1)`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            if (bankType === "sfe32" || bankType === "sfe64")
                            {
                                SpessaSynthWarn(`Legacy synthesis engines are deprecated.`);
                            }
                            break;
                        case "E-mu 10K2":
                            SpessaSynthInfo(
                                `%cSynthesis engine: %cSB Audigy (EMU10K2)`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            if (bankType === "sfe32" || bankType === "sfe64")
                            {
                                SpessaSynthWarn(`Legacy synthesis engines are deprecated.`);
                            }
                            break;
                        case "X-Fi":
                            SpessaSynthInfo(
                                `%cSynthesis engine: %cSB X-Fi (EMU20Kx)`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            if (bankType === "sfe32" || bankType === "sfe64")
                            {
                                SpessaSynthWarn(`Legacy synthesis engines are deprecated.`);
                            }
                            break;
                        case "SFe 4":
                            SpessaSynthInfo(
                                `%cSynthesis engine: %cSFe 4`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            break;
                        default:
                            SpessaSynthWarn(`Unknown synthesis engine: "${text}". Using SFe 4 engine.`);
                    }
                    break;
                case "icrd":
                    text = readBytesAsString(chunk.chunkData, chunk.chunkData.length, undefined, false);
                    this.soundFontInfo[chunk.header] = text;
                    let dateValue;
                    let dateMonth;
                    let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; // Todo: add localisation
                    let timeValue;
                    switch (text.length)
                    {
                        case 10: // Date only, time set to 12:00:00
                            this.soundFontInfo[chunk.header + ".year"] = text.substring(0,4);
                            this.soundFontInfo[chunk.header + ".month"] = text.substring(5,7);
                            this.soundFontInfo[chunk.header + ".day"] = text.substring(8,10);
                            this.soundFontInfo[chunk.header + ".hour"] = `12`;
                            this.soundFontInfo[chunk.header + ".minute"] = `00`;
                            this.soundFontInfo[chunk.header + ".second"] = `00`;

                            // Create human-readable date value for display in console
                            dateMonth = months[parseInt(`${this.soundFontInfo[chunk.header + ".month"]}`) - 1];
                            dateValue = `${this.soundFontInfo[chunk.header + ".day"]} ${dateMonth} ${this.soundFontInfo[chunk.header + ".year"]}`; 
                            SpessaSynthInfo(
                                `%cCreation date: %c${dateValue}`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            break;
                        case 20: // Date and time
                            this.soundFontInfo[chunk.header + ".year"] = text.substring(0,4);
                            this.soundFontInfo[chunk.header + ".month"] = text.substring(5,7);
                            this.soundFontInfo[chunk.header + ".day"] = text.substring(8,10);
                            this.soundFontInfo[chunk.header + ".hour"] = text.substring(11,13);
                            this.soundFontInfo[chunk.header + ".minute"] = text.substring(14,16);
                            this.soundFontInfo[chunk.header + ".second"] = text.substring(17,19);

                            // Create human-readable date and time value for display in console
                            dateMonth = months[parseInt(`${this.soundFontInfo[chunk.header + ".month"]}`) - 1];
                            dateValue = `${this.soundFontInfo[chunk.header + ".day"]} ${dateMonth} ${this.soundFontInfo[chunk.header + ".year"]}`; 
                            SpessaSynthInfo(
                                `%cCreation date: %c${dateValue}`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            if (parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) === 0)
                            {
                                timeValue = `12:${text.substring(14,19)} am`;
                            } else if ((parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) > 0) && (parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) < 12))
                            {
                                timeValue = `${this.soundFontInfo[chunk.header + ".hour"]}:${text.substring(14,19)} am`;
                            } else if (parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) === 12) 
                            {
                                timeValue = `12:${text.substring(14,19)} pm`;
                            } else if ((parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) > 12) && (parseInt(`${this.soundFontInfo[chunk.header + ".hour"]}`) < 24)) 
                            {
                                timeValue = `${this.soundFontInfo[chunk.header + ".hour"] - 12}:${text.substring(14,19)} pm`;
                            }
                            SpessaSynthInfo(
                                `%cCreation time: %c${timeValue}`,
                                consoleColors.info,
                                consoleColors.recognized
                            );
                            break;
                        default: // Length isn't valid
                        if (bankType === "sfe32" || bankType === "sfe64")
                        {
                            SpessaSynthWarn(`Creation date not in ISO8601 format: "${text}"`);
                        }
                    }
                    break;

                case "icmt":
                    text = readBytesAsString(chunk.chunkData, chunk.chunkData.length, undefined, false);
                    this.soundFontInfo[chunk.header] = text;
                    SpessaSynthInfo(
                        `%c"${chunk.header}": %c"${text}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    break;
                
                // dmod: default modulators
                case "dmod":
                    const newModulators = readModulators(chunk);
                    text = `Modulators: ${newModulators.length}`;
                        
                    // override default modulators
                    this.defaultModulators = newModulators;
                    this.customDefaultModulators = true;
                    this.soundFontInfo[chunk.header] = text;
                    SpessaSynthInfo(
                        `%c"${chunk.header}": %c"${text}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
                    break;
                // nested lists: isfe is nested inside info.
                // the code is in sfe_info.js.         
                case "list":
                    // possible xdta
                    const listType = readBytesAsString(chunk.chunkData, 4);
                    if (listType === "ISFe")
                    {
                        isfePresent = true;
                        let nestedChunk;
                        let text;
                        let sfeVersion;
                        while (chunk.chunkData.length > chunk.chunkData.currentIndex)
                        {
                            nestedChunk = readRIFFChunk(chunk.chunkData, true, false, is64Bit);
                            switch (nestedChunk.header.toLowerCase())
                            {
                                case "sfvx":
                                    this.sfeInfo["SFvx.wSFeSpecMajorVersion"] = readLittleEndian(nestedChunk.chunkData, 2);
                                    this.sfeInfo["SFvx.wSFeSpecMinorVersion"] = readLittleEndian(nestedChunk.chunkData, 2);
                                    this.sfeInfo["SFvx.achSFeSpecType"] = readBytesAsString(nestedChunk.chunkData, 20);
                                    this.sfeInfo["SFvx.wSFeDraftMilestone"] = readLittleEndian(nestedChunk.chunkData, 2);
                                    this.sfeInfo["SFvx.achSFeFullVersion"] = readBytesAsString(nestedChunk.chunkData, 20);

                                    sfeVersion = `${this.sfeInfo["SFvx.wSFeSpecMajorVersion"]}.${this.sfeInfo["SFvx.wSFeSpecMinorVersion"]}`
                                    SpessaSynthInfo(
                                        `%cSFe extended version number: %c${sfeVersion}`,
                                        consoleColors.info,
                                        consoleColors.recognized
                                    );
                                    
                                    SpessaSynthInfo(
                                        `%cSFe specification type: %c"${this.sfeInfo["SFvx.achSFeSpecType"]}"`,
                                        consoleColors.info,
                                        consoleColors.recognized
                                    );
                                    if (this.sfeInfo["SFvx.wSFeDraftMilestone"] > 0)
                                    {
                                        SpessaSynthInfo(
                                            `%cSFe draft milestone: %c${this.sfeInfo["SFvx.wSFeDraftMilestone"]}`,
                                            consoleColors.info,
                                            consoleColors.recognized
                                        );
                                    }
                                    SpessaSynthInfo(
                                        `%cSFe version string: %c"${this.sfeInfo["SFvx.achSFeFullVersion"]}"`,
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
                                    let leafIndexArray = new Uint16Array(nestedChunk.chunkData.length / 6);
                                    while (flagIndex < nestedChunk.chunkData.length)
                                    {
                                        // Access feature flags with this.sfeInfo[flag.<branch>.<leaf>] and use a bitwise AND operator for the desired flag(s).
                                        flagBranch = `${readLittleEndian(nestedChunk.chunkData.slice(flagIndex,flagIndex+1),1)}`; // branch
                                        flagLeaf = `${readLittleEndian(nestedChunk.chunkData.slice(flagIndex+1,flagIndex+2),1)}`; // leaf
                                        flagFlags = `${readLittleEndian(nestedChunk.chunkData.slice(flagIndex+2,flagIndex+6),4)}`; // flags (32 bits)
                                        this.sfeInfo[nestedChunk.header + "." + flagBranch + "." + flagLeaf] = flagFlags;
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
                                                verifyFlag(15,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.0"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1: // looping
                                                verifyFlag(3,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.1"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 2: // filter types
                                                verifyFlag(1,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.2"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 3: // filter params
                                                verifyFlag(884736096,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.3"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 4: // attenuation
                                                verifyFlag(7,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.4"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 5: // effects
                                                verifyFlag(69391,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.5"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 6: // LFO
                                                verifyFlag(15,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.6"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 7: // envelopes
                                                verifyFlag(524287,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.7"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 8: // MIDI CC
                                                verifyFlag(231169,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.8"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 9: // generators
                                                verifyFlag(127,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.9"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 10: // zones
                                                verifyFlag(127,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.10"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 11: // reserved
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".0.11"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 256: // modulators
                                                verifyFlag(16383,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.0"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 257: // mod controllers
                                                verifyFlag(51,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.1"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 258: // mod params 1
                                                verifyFlag(998838,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.2"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 259: // mod params 2
                                                verifyFlag(672137215,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.3"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 260: // mod params 3
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.4"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 261: // NRPN
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.5"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 262: // default modulators
                                                verifyFlag(263167,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.6"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 263: // reserved
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.7"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 264: // reserved
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".1.8"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 512: // 24bit
                                                verifyFlag(1,`${parseInt(this.sfeInfo[nestedChunk.header + ".2.0"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 513: // 8bit
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".2.1"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 514: // 32bit
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".2.2"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 515: // 64bit
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".2.3"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 768: // SFe Compression
                                                verifyFlag(1,`${parseInt(this.sfeInfo[nestedChunk.header + ".3.0"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 769: // compression formats
                                                verifyFlag(1,`${parseInt(this.sfeInfo[nestedChunk.header + ".3.1"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1024: // metadata
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".4.0"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1025: // reserved
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".4.1"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1026: // sample ROMs
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".4.2"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1027: // ROM emulator
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".4.3"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1028: // reserved
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".4.4"])}`,flagBranch,flagLeaf);
                                                break;
                                            case 1280: // end of flags
                                                verifyFlag(0,`${parseInt(this.sfeInfo[nestedChunk.header + ".5.0"])}`,flagBranch,flagLeaf);
                                        }
                                    }
                                    break;

                                default:
                                    text = readBytesAsString(nestedChunk.chunkData, nestedChunk.chunkData.length);
                                    this.sfeInfo[nestedChunk.header] = text,
                                    SpessaSynthInfo(
                                        `%c"isfe.${nestedChunk.header}": %c"${text}"`,
                                        consoleColors.info,
                                        consoleColors.recognized
                                    );
                            }
                        }




                    } else if (listType === "xdta")
                    {
                        SpessaSynthInfo("%cExtended SF2 found!", consoleColors.recognized);
                        xdtaChunk = chunk;
                    } else {
                        SpessaSynthWarn(`Unrecognised nested list chunk found: ${listType}`);
                    }
                    break;
                
                default:
                    text = readBytesAsString(chunk.chunkData, chunk.chunkData.length);
                    this.soundFontInfo[chunk.header] = text;
                    SpessaSynthInfo(
                        `%c"${chunk.header}": %c"${text}"`,
                        consoleColors.info,
                        consoleColors.recognized
                    );
            }
        }
        // https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md
        const isExtended = xdtaChunk !== undefined;
        /**
         * @type {{
         *     phdr: RiffChunk,
         *     pbag: RiffChunk,
         *     pmod: RiffChunk,
         *     pgen: RiffChunk,
         *     inst: RiffChunk,
         *     ibag: RiffChunk,
         *     imod: RiffChunk,
         *     igen: RiffChunk,
         *     shdr: RiffChunk,
         * }}
         */
        let xChunks = {};
        if (isExtended)
        {
            // read the hydra chunks
            xChunks.phdr = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.pbag = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.pmod = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.pgen = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.inst = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.ibag = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.imod = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.igen = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
            xChunks.shdr = readRIFFChunk(xdtaChunk.chunkData, true, false, is64Bit);
        }
        
        if (isfePresent === false)
        {
            console.log("No ISFe chunk found. Generating ISFe chunk...");

            // sfty - SFe type
            this.sfeInfo["SFty"] = "SFe standard";

            // sfvx - SFe extended version information
            this.sfeInfo["SFvx.wSFeSpecMajorVersion"] = 4;
            this.sfeInfo["SFvx.wSFeSpecMinorVersion"] = 0;
            this.sfeInfo["SFvx.achSFeSpecType"] = "Final";
            this.sfeInfo["SFvx.wSFeDraftMilestone"] = 0;
            this.sfeInfo["SFvx.achSFeFullVersion"] = "4.0u18";

            // flag - Feature flags (detection not yet implemented)
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

        // SDTA
        const sdtaChunk = readRIFFChunk(mainFileArray, false, false, is64Bit);
        this.verifyHeader(sdtaChunk, "list");
        this.verifyText(readBytesAsString(mainFileArray, 4), "sdta");
        
        // smpl
        SpessaSynthInfo("%cVerifying smpl chunk...", consoleColors.warn);
        let sampleDataChunk = readRIFFChunk(mainFileArray, false, false, is64Bit);
        this.verifyHeader(sampleDataChunk, "smpl");
        /**
         * @type {IndexedByteArray|Float32Array}
         */
        let sampleData;
        // SF2Pack: the entire data is compressed
        if (isSF2Pack)
        {
            SpessaSynthInfo(
                "%cSF2Pack detected, attempting to decode the smpl chunk...",
                consoleColors.info
            );
            try
            {
                /**
                 * @type {Float32Array}
                 */
                sampleData = stbvorbis.decode(mainFileArray.buffer.slice(
                    mainFileArray.currentIndex,
                    mainFileArray.currentIndex + sdtaChunk.size - chunkBacktrack
                )).data[0];
            }
            catch (e)
            {
                SpessaSynthGroupEnd();
                throw new Error(`SF2Pack Ogg Vorbis decode error: ${e}`);
            }
            SpessaSynthInfo(
                `%cDecoded the smpl chunk! Length: %c${sampleData.length}`,
                consoleColors.info,
                consoleColors.value
            );
        }
        else
        {
            /**
             * @type {IndexedByteArray}
             */
            sampleData = mainFileArray;
            this.sampleDataStartIndex = mainFileArray.currentIndex;
        }
        
        SpessaSynthInfo(
            `%cSkipping sample chunk, length: %c${sdtaChunk.size - chunkBacktrack}`,
            consoleColors.info,
            consoleColors.value
        );
        mainFileArray.currentIndex += sdtaChunk.size - chunkBacktrack;
        
        // PDTA
        SpessaSynthInfo("%cLoading preset data chunk...", consoleColors.warn);
        let presetChunk = readRIFFChunk(mainFileArray, true, false, is64Bit);
        this.verifyHeader(presetChunk, "list");
        readBytesAsString(presetChunk.chunkData, 4);
        
        // read the hydra chunks
        const phdrChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(phdrChunk, "phdr");
        
        const pbagChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(pbagChunk, "pbag");
        
        const pmodChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(pmodChunk, "pmod");
        
        const pgenChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(pgenChunk, "pgen");
        
        const instChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(instChunk, "inst");
        
        const ibagChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(ibagChunk, "ibag");
        
        const imodChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(imodChunk, "imod");
        
        const igenChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(igenChunk, "igen");
        
        const shdrChunk = readRIFFChunk(presetChunk.chunkData, true, false, is64Bit);
        this.verifyHeader(shdrChunk, "shdr");
        
        /**
         * read all the samples
         * (the current index points to start of the smpl read)
         */
        mainFileArray.currentIndex = this.sampleDataStartIndex;
        const samples = readSamples(shdrChunk, sampleData, !isExtended);
        
        if (isExtended)
        {
            // apply extensions to samples
            const xSamples = readSamples(xChunks.shdr, new Float32Array(1), false);
            if (xSamples.length === samples.length)
            {
                samples.forEach((s, i) =>
                {
                    s.sampleName += xSamples[i].sampleName;
                    s.linkedSampleIndex |= xSamples[i].linkedSampleIndex << 16;
                    if (is64Bit)
                    {
                        s.sampleStartIndex |= xSamples[i].sampleStartIndex << 32;
                        s.sampleEndIndex |= xSamples[i].sampleEndIndex << 32;
                        s.sampleLoopStartIndex |= xSamples[i].sampleLoopStartIndex << 32;
                        s.sampleLoopEndIndex |= xSamples[i].sampleLoopEndIndex << 32;
                    }
                });
            }
        }
        // trim names
        samples.forEach(s => s.sampleName = s.sampleName.trim());
        this.samples.push(...samples);
        
        /**
         * read all the instrument generators
         * @type {Generator[]}
         */
        let instrumentGenerators = readGenerators(igenChunk);
        
        /**
         * read all the instrument modulators
         * @type {Modulator[]}
         */
        let instrumentModulators = readModulators(imodChunk);
        
        const instruments = readInstruments(instChunk);
        
        if (isExtended)
        {
            // apply extensions to instruments
            const xInst = readInstruments(xChunks.inst);
            if (xInst.length === instruments.length)
            {
                instruments.forEach((inst, i) =>
                {
                    inst.instrumentName += xInst[i].instrumentName;
                    inst.zoneStartIndex |= xInst[i].zoneStartIndex;
                });
                // adjust zone counts
                instruments.forEach((inst, i) =>
                {
                    if (i < instruments.length - 1)
                    {
                        inst.zonesCount = instruments[i + 1].zoneStartIndex - inst.zoneStartIndex;
                    }
                });
            }
            
        }
        // trim names
        instruments.forEach(i => i.instrumentName = i.instrumentName.trim());
        this.instruments.push(...instruments);
        
        const ibagIndexes = readZoneIndexes(ibagChunk);
        
        if (isExtended)
        {
            const extraIndexes = readZoneIndexes(xChunks.ibag);
            for (let i = 0; i < ibagIndexes.mod.length; i++)
            {
                ibagIndexes.mod[i] |= extraIndexes.mod[i] << 16;
            }
            for (let i = 0; i < ibagIndexes.gen.length; i++)
            {
                ibagIndexes.gen[i] |= extraIndexes.gen[i] << 16;
            }
        }
        
        /**
         * read all the instrument zones (and apply them)
         * @type {InstrumentZone[]}
         */
        applyInstrumentZones(
            ibagIndexes,
            instrumentGenerators,
            instrumentModulators,
            this.samples,
            this.instruments
        );
        
        /**
         * read all the preset generators
         * @type {Generator[]}
         */
        let presetGenerators = readGenerators(pgenChunk);
        
        /**
         * Read all the preset modulatorrs
         * @type {Modulator[]}
         */
        let presetModulators = readModulators(pmodChunk);
        
        const presets = readPresets(phdrChunk, this);
        
        if (isExtended)
        {
            // apply extensions to presets
            const xPreset = readPresets(xChunks.phdr, this);
            if (xPreset.length === presets.length)
            {
                presets.forEach((pres, i) =>
                {
                    pres.presetName += xPreset[i].presetName;
                    pres.zoneStartIndex |= xPreset[i].zoneStartIndex;
                });
                // adjust zone counts
                presets.forEach((preset, i) =>
                {
                    if (i < presets.length - 1)
                    {
                        preset.zonesCount = presets[i + 1].zoneStartIndex - preset.zoneStartIndex;
                    }
                });
            }
            
        }
        
        // trim names
        presets.forEach(p => p.presetName === p.presetName.trim());
        this.addPresets(...presets);
        
        const pbagIndexes = readZoneIndexes(pbagChunk);
        
        if (isExtended)
        {
            const extraIndexes = readZoneIndexes(xChunks.pbag);
            for (let i = 0; i < pbagIndexes.mod.length; i++)
            {
                pbagIndexes.mod[i] |= extraIndexes.mod[i] << 16;
            }
            for (let i = 0; i < pbagIndexes.gen.length; i++)
            {
                pbagIndexes.gen[i] |= extraIndexes.gen[i] << 16;
            }
        }
        
        applyPresetZones(pbagIndexes, presetGenerators, presetModulators, this.instruments, this.presets);
        this.flush();
        SpessaSynthInfo(
            `%cParsing finished! %c"${this.soundFontInfo["INAM"]}"%c has %c${this.presets.length} %cpresets,
        %c${this.instruments.length}%c instruments and %c${this.samples.length}%c samples.`,
            consoleColors.info,
            consoleColors.recognized,
            consoleColors.info,
            consoleColors.recognized,
            consoleColors.info,
            consoleColors.recognized,
            consoleColors.info,
            consoleColors.recognized,
            consoleColors.info
        );
        SpessaSynthGroupEnd();
    }
    
    /**
     * @param chunk {RiffChunk}
     * @param expected {string}
     */
    verifyHeader(chunk, expected)
    {
        if (chunk.header.toLowerCase() !== expected.toLowerCase())
        {
            SpessaSynthGroupEnd();
            this.parsingError(`Invalid chunk header! Expected "${expected.toLowerCase()}" got "${chunk.header.toLowerCase()}"`);
        }
    }
    
    /**
     * @param text {string}
     * @param expected {string}
     */
    verifyText(text, expected)
    {
        if (text.toLowerCase() !== expected.toLowerCase())
        {
            SpessaSynthGroupEnd();
            this.parsingError(`Invalid FourCC: Expected "${expected.toLowerCase()}" got "${text.toLowerCase()}"\``);
        }
    }
}