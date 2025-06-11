import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readSamples } from "./samples.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { readGenerators } from "./generators.js";
import { readPresetZones } from "./preset_zones.js";
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
import { Modulator } from "../basic_soundfont/modulator.js";
import { loadSFeInfo } from "./sfe_info.js";
import { InstrumentZone, readInstrumentZones } from "./instrument_zones.js";

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
        this.dataArray = new IndexedByteArray(arrayBuffer);
        SpessaSynthGroup("%cParsing SoundFont...", consoleColors.info);
        if (!this.dataArray)
        {
            SpessaSynthGroupEnd();
            this.parsingError("No data provided!");
        }
        
        // read the main read
        let firstChunk = readRIFFChunk(this.dataArray, false);
        const firstHeader = firstChunk.header.toLowerCase();
        if (firstHeader !== "riff" && firstHeader !== "rf64")
        {
            SpessaSynthGroupEnd();
            this.parsingError(`Invalid chunk header! Expected "riff" or "rf64" got "${firstHeader}"`);
        }

        const type = readBytesAsString(this.dataArray, 4).toLowerCase();
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
            case "rf64":
                switch (type)
                {
                    // 64-bit chunk headers can only be used with SFe.
                    case "sfen":
                        bankType = "sfe64";
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
        let infoChunk = readRIFFChunk(this.dataArray);
        this.verifyHeader(infoChunk, "list");
        readBytesAsString(infoChunk.chunkData, 4);
        
        while (infoChunk.chunkData.length > infoChunk.chunkData.currentIndex)
        {
            let chunk = readRIFFChunk(infoChunk.chunkData);
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
                                    const sfeVersion = text;
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
                    newModulators.pop(); // remove the terminal record
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
                    const listHeader = readBytesAsString(chunk.chunkData, 4);

                    switch (listHeader.toLowerCase())
                    {
                        case "isfe":
                            let sfeInfo = loadSFeInfo(chunk.chunkData, false);
                            this.sfeInfo = sfeInfo.sfeInfo;
                            break;
                        default:
                            SpessaSynthWarn(`Unrecognised nested list chunk found: ${listHeader}`);
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
        
        // SDTA
        const sdtaChunk = readRIFFChunk(this.dataArray, false);
        this.verifyHeader(sdtaChunk, "list");
        this.verifyText(readBytesAsString(this.dataArray, 4), "sdta");
        
        // smpl
        SpessaSynthInfo("%cVerifying smpl chunk...", consoleColors.warn);
        let sampleDataChunk = readRIFFChunk(this.dataArray, false);
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
                sampleData = stbvorbis.decode(this.dataArray.buffer.slice(
                    this.dataArray.currentIndex,
                    this.dataArray.currentIndex + sdtaChunk.size - 12
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
            sampleData = this.dataArray;
            this.sampleDataStartIndex = this.dataArray.currentIndex;
        }
        
        SpessaSynthInfo(
            `%cSkipping sample chunk, length: %c${sdtaChunk.size - 12}`,
            consoleColors.info,
            consoleColors.value
        );
        this.dataArray.currentIndex += sdtaChunk.size - 12;
        
        // PDTA
        SpessaSynthInfo("%cLoading preset data chunk...", consoleColors.warn);
        let presetChunk = readRIFFChunk(this.dataArray);
        this.verifyHeader(presetChunk, "list");
        readBytesAsString(presetChunk.chunkData, 4);
        
        // read the hydra chunks
        const pHdrChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(pHdrChunk, "phdr");
        
        const pBagChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(pBagChunk, "pbag");
        
        const pModChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(pModChunk, "pmod");
        
        const pGenChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(pGenChunk, "pgen");
        
        const instChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(instChunk, "inst");
        
        const iBagChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(iBagChunk, "ibag");
        
        const iModChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(iModChunk, "imod");
        
        const iGenChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(iGenChunk, "igen");
        
        const sHdrChunk = readRIFFChunk(presetChunk.chunkData);
        this.verifyHeader(sHdrChunk, "shdr");
        
        /**
         * read all the samples
         * (the current index points to start of the smpl read)
         */
        this.dataArray.currentIndex = this.sampleDataStartIndex;
        this.samples.push(...readSamples(sHdrChunk, sampleData, !isSF2Pack));
        
        /**
         * read all the instrument generators
         * @type {Generator[]}
         */
        let instrumentGenerators = readGenerators(iGenChunk);
        
        /**
         * read all the instrument modulators
         * @type {Modulator[]}
         */
        let instrumentModulators = readModulators(iModChunk);
        
        this.instruments = readInstruments(instChunk);
        /**
         * read all the instrument zones (and apply them)
         * @type {InstrumentZone[]}
         */
        readInstrumentZones(
            iBagChunk,
            instrumentGenerators,
            instrumentModulators,
            this.samples,
            this.instruments
        );
        
        /**
         * read all the preset generators
         * @type {Generator[]}
         */
        let presetGenerators = readGenerators(pGenChunk);
        
        /**
         * Read all the preset modulatorrs
         * @type {Modulator[]}
         */
        let presetModulators = readModulators(pModChunk);
        
        this.addPresets(...readPresets(pHdrChunk, this));
        
        readPresetZones(pBagChunk, presetGenerators, presetModulators, this.instruments, this.presets);
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
        
        if (isSF2Pack)
        {
            delete this.dataArray;
        }
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

    destroySoundBank()
    {
        super.destroySoundBank();
        delete this.dataArray;
    }
}