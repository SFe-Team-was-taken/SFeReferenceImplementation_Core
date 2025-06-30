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
import { loadSFeInfo } from "./sfe_info.js";
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
                        let sfeInfo = loadSFeInfo(chunk.chunkData, is64Bit);
                        this.sfeInfo = sfeInfo.sfeInfo;
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