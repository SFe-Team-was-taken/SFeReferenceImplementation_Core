import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeRIFFChunkParts, writeRIFFChunkRaw } from "../riff_chunk.js";
import { getStringBytes } from "../../../utils/byte_functions/string.js";
import { consoleColors } from "../../../utils/other.js";
import { getIGEN } from "./igen.js";
import { getSDTA } from "./sdta.js";
import { getSHDR } from "./shdr.js";
import { getIMOD } from "./imod.js";
import { getIBAG } from "./ibag.js";
import { getINST } from "./inst.js";
import { getPGEN } from "./pgen.js";
import { getPMOD } from "./pmod.js";
import { getPBAG } from "./pbag.js";
import { getPHDR } from "./phdr.js";
import { getSFty } from "./sfty.js";
import { getSFvx } from "./sfvx.js";
import { getFlag } from "./flag.js";
import { writeLittleEndian, writeWord } from "../../../utils/byte_functions/little_endian.js";
import { SpessaSynthGroupCollapsed, SpessaSynthGroupEnd, SpessaSynthInfo } from "../../../utils/loggin.js";
import { MOD_BYTE_SIZE } from "../modulator.js";
import { fillWithDefaults } from "../../../utils/fill_with_defaults.js";

/**
 * @typedef {function} ProgressFunction
 * @param {string} sampleName - the written sample name.
 * @param {number} sampleIndex - the sample's index.
 * @param {number} sampleCount - the total sample count for progress displaying.
 */

/**
 * @typedef {Object} SoundFont2WriteOptions
 * @property {boolean} compress - if the soundfont should be compressed with a given function.
 * @property {SampleEncodingFunction} compressionFunction -
 * the encode vorbis function. It can be undefined if not compressed.
 * @property {ProgressFunction} progressFunction - a function to show progress for writing large banks. It can be undefined.
 * @property {boolean} writeDefaultModulators - if the DMOD chunk should be written.
 * Recommended.
 * @property {boolean} writeExtendedLimits - if the xdta chunk should be written to allow virtually infinite parameters.
 * Recommended.
 * @property {boolean} decompress - if an sf3 bank should be decompressed back to sf2. Not recommended.
 * @property {string} bankVersion - version of SF bank to write.
 * @property {boolean} enable64Bit - enable 64-bit. Recommended only for supported players.
 */


/**
 * @typedef {Object} ReturnedExtendedSf2Chunks
 * @property {IndexedByteArray} pdta - the pdta part of the chunk
 * @property {IndexedByteArray} xdta - the xdta (https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md) part of the chunk
 * @property {number} highestIndex - the highest index written (0 if not applicable). Used for determining whether the xdta chunk is necessary.
 */

/**
 * @type {SoundFont2WriteOptions}
 */
const DEFAULT_WRITE_OPTIONS = {
    compress: false,
    compressionQuality: 0.5,
    compressionFunction: undefined,
    progressFunction: undefined,
    writeDefaultModulators: true,
    writeExtendedLimits: true,
    decompress: false,
    bankVersion: "soundfont2",
    enable64Bit: false
};

/**
 * Write the soundfont as an .sf2 file
 * @this {BasicSoundBank}
 * @param {Partial<SoundFont2WriteOptions>} options
 * @returns {Uint8Array}
 */
export async function write(options = DEFAULT_WRITE_OPTIONS)
{
    options = fillWithDefaults(options, DEFAULT_WRITE_OPTIONS);
    if (options?.compress)
    {
        if (typeof options?.compressionFunction !== "function")
        {
            throw new Error("No compression function supplied but compression enabled.");
        }
        if (options?.decompress)
        {
            throw new Error("Decompressed and compressed at the same time.");
        }
    }

    switch(options?.bankVersion)
    {
        case ("soundfont2"):
            this.soundFontInfo["ifil.wMajor"] = 2;
            this.soundFontInfo["ifil.wMinor"] = 1;
            break;
        case ("sfe-4.0"):
            if (options?.enable64Bit)
            {
                this.soundFontInfo["ifil.wMajor"] = 4;
                this.soundFontInfo["ifil.wMinor"] = 0;
                this.soundFontInfo["isng"] = "SFe 4";
            }
            else
            {
                this.soundFontInfo["ifil.wMajor"] = 2;
                this.soundFontInfo["ifil.wMinor"] = 1024;
                this.soundFontInfo["isng"] = "SFe 4";
            }
            break;
        default:
            throw new Error(`Invalid bank version: "${options?.bankVersion}"`);
    }
    if (options?.bankVersion == "soundfont2" && options?.enable64Bit == true)
    {
        throw new Error("64-bit chunk headers can only be used with SFe.");
    }
    if (options?.bankVersion == "sfe-4.0" && options?.writeExtendedLimits == false)
    {
        throw new Error("64-bit chunk headers require use of the xdta sub-chunk."); // the 64-bit sample indices are stored in xshdr
    }
    SpessaSynthGroupCollapsed(
        "%cSaving soundfont...",
        consoleColors.info
    );
    SpessaSynthInfo(
        `%cCompression: %c${options?.compress || "false"}%c quality: %c${options?.compressionQuality || "none"}`,
        consoleColors.info,
        consoleColors.recognized,
        consoleColors.info,
        consoleColors.recognized
    );
    SpessaSynthInfo(
        "%cWriting INFO...",
        consoleColors.info
    );
    /**
     * Write INFO
     * @type {IndexedByteArray[]}
     */
    const infoArrays = [];
    this.soundFontInfo["ISFT"] = "SpessaSynth"; // ( ͡° ͜ʖ ͡°)
    if (options?.compress || this.samples.some(s => s.isCompressed))
    {
        this.soundFontInfo["ifil.wMajor"] = "3"; // set version to 3, wMinor unchanged
    }
    if (options?.decompress)
    {
        if (options?.bankVersion == "soundfont2") // 2.01 usage will be added when proper 24-bit is added
        {
            this.soundFontInfo["ifil"] = "2.4"; // set version to 2.04
        } else if (options?.bankVersion == "sfe-4.0" && options?.enable64Bit == false) {
            this.soundFontInfo["ifil"] = "2.1024"; // set version to 2.1024 (SFe)
        } else if (options?.bankVersion == "sfe-4.0" && options?.enable64Bit == true) {
            this.soundFontInfo["ifil"] = "4.0"; // set version to 4.0 (SFe)
        } else {
            throw new Error("Invalid bank version!");
        }
    }
    this.soundFontInfo["ifil"] = this.soundFontInfo["ifil.wMajor"] + "." + this.soundFontInfo["ifil.wMinor"];
    if (options?.writeDefaultModulators)
    {
        // trigger the DMOD write
        this.soundFontInfo["DMOD"] = `${this.defaultModulators.length} Modulators`;
        this.customDefaultModulators = true;
    }
    else
    {
        delete this.soundFontInfo["DMOD"];
    }
    
    for (const [type, data] of Object.entries(this.soundFontInfo))
    {
        if (type === "ifil" || type === "iver")
        {
            const major = parseInt(data.split(".")[0]);
            const minor = parseInt(data.split(".")[1]);
            const ckdata = new IndexedByteArray(4);
            writeWord(ckdata, major);
            writeWord(ckdata, minor);
            infoArrays.push(writeRIFFChunkRaw(type, ckdata, false, false, options?.enable64Bit));
        }
        else if (type === "DMOD")
        {
            const mods = this.defaultModulators;
            SpessaSynthInfo(
                `%cWriting %c${mods.length}%c default modulators...`,
                consoleColors.info,
                consoleColors.recognized,
                consoleColors.info
            );
            let dmodsize = MOD_BYTE_SIZE + mods.length * MOD_BYTE_SIZE;
            const dmoddata = new IndexedByteArray(dmodsize);
            for (const mod of mods)
            {
                writeWord(dmoddata, mod.getSourceEnum());
                writeWord(dmoddata, mod.modulatorDestination);
                writeWord(dmoddata, mod.transformAmount);
                writeWord(dmoddata, mod.getSecSrcEnum());
                writeWord(dmoddata, mod.transformType);
            }
            
            // terminal modulator, is zero
            writeLittleEndian(dmoddata, 0, MOD_BYTE_SIZE);
            
            infoArrays.push(writeRIFFChunkRaw(type, dmoddata, false, false, options?.enable64Bit));
        }
        else if (type === "ifil.wMajor" || type === "ifil.wMinor" || type === "iver.wMajor" || type === "iver.wMinor")
        {
            // These are SpessaSynth internal values and must not be written
        }
        else if (type === "ICRD.year" || type === "ICRD.month" || type === "ICRD.day" || type === "ICRD.hour" || type === "ICRD.minute" || type === "ICRD.second")
        {
            // These are SpessaSynth internal values and must not be written
        }
        else
        {
            infoArrays.push(writeRIFFChunkRaw(
                type,
                getStringBytes(data, true, true), // pad with zero and ensure even length
                false,
                false,
                options?.enable64Bit
            ));
        }
    }
    
    SpessaSynthInfo(
        "%cWriting SDTA...",
        consoleColors.info
    );
    // write sdta
    const smplStartOffsets = [];
    const smplEndOffsets = [];
    const sdtaChunk = await getSDTA.call(
        this,
        smplStartOffsets,
        smplEndOffsets,
        options.compress,
        options.decompress,
        options?.compressionFunction,
        options?.progressFunction,
        options?.enable64Bit
    );
    
    SpessaSynthInfo(
        "%cWriting PDTA...",
        consoleColors.info
    );
    // write pdta
    // go in reverse so the indexes are correct
    // instruments
    SpessaSynthInfo(
        "%cWriting SHDR...",
        consoleColors.info
    );
    const shdrChunk = getSHDR.call(
        this, 
        smplStartOffsets, 
        smplEndOffsets,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting IGEN...",
        consoleColors.info
    );
    const igenChunk = getIGEN.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting IMOD...",
        consoleColors.info
    );
    const imodChunk = getIMOD.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting IBAG...",
        consoleColors.info
    );
    const ibagChunk = getIBAG.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting INST...",
        consoleColors.info
    );
    const instChunk = getINST.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting PGEN...",
        consoleColors.info
    );
    // presets
    const pgenChunk = getPGEN.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting PMOD...",
        consoleColors.info
    );
    const pmodChunk = getPMOD.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting PBAG...",
        consoleColors.info
    );
    const pbagChunk = getPBAG.call(
        this,
        options?.enable64Bit
    );
    SpessaSynthInfo(
        "%cWriting PHDR...",
        consoleColors.info
    );
    const phdrChunk = getPHDR.call(
        this,
        options?.bankVersion,
        options?.enable64Bit
    );
    /**
     * @type {ReturnedExtendedSf2Chunks[]}
     */
    const chunks = [phdrChunk, pbagChunk, pmodChunk, pgenChunk, instChunk, ibagChunk, imodChunk, igenChunk, shdrChunk];
    // combine in the sfspec order
    const pdtaChunk = writeRIFFChunkParts(
        "pdta",
        chunks.map(c => c.pdta),
        true,
        options?.enable64Bit
    );
    const maxIndex = Math.max(
        ...chunks.map(c => c.highestIndex)
    );
    
    const writeXdta = options.writeExtendedLimits && (
        maxIndex > 0xFFFF
        || this.presets.some(p => p.presetName.length > 20)
        || this.instruments.some(i => i.instrumentName.length > 20)
        || this.samples.some(s => s.sampleName.length > 20)
    );
    
    if (writeXdta || options.enable64Bit)
    {
        SpessaSynthInfo(
            `%cWriting the xdta chunk! Max index: %c${maxIndex}`,
            consoleColors.info,
            consoleColors.value
        );
        
        // https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md
        const xpdtaChunk = writeRIFFChunkParts("xdta", chunks.map(c => c.xdta), true, options?.enable64Bit);
        infoArrays.push(xpdtaChunk);
    }
    
    // Write ISFe-list chunk (SFe only)
    if (options?.bankVersion == "sfe-4.0")
    {
        SpessaSynthInfo(
            "%cWriting ISFe...",
            consoleColors.info
        )

        const sftyChunk = getSFty.call(
            this,
            options?.enable64Bit
        );

        const sfvxChunk = getSFvx.call(
            this,
            options?.enable64Bit
        );

        const flagChunk = getFlag.call(
            this,
            options?.enable64Bit
        );

        /**
         * @type {ReturnedExtendedSf2Chunks[]}
         */
        const isfeSubChunks = [sftyChunk, sfvxChunk, flagChunk];

        const isfeChunk = writeRIFFChunkParts(
            "ISFe",
            isfeSubChunks,
            true,
            options?.enable64Bit
        );
        infoArrays.push(isfeChunk);
    }

    const infoChunk = writeRIFFChunkParts("INFO", infoArrays, true, options?.enable64Bit);
    SpessaSynthInfo(
        "%cWriting the output file...",
        consoleColors.info
    );
    // finally, combine everything
    let main; 
    
    if (options?.enable64Bit)
    {
        main = writeRIFFChunkParts(
            "RIFS",
            [getStringBytes("sfen"), infoChunk, sdtaChunk, pdtaChunk],
            false,
            options?.enable64Bit
        );
    } else {
        main = writeRIFFChunkParts(
            "RIFF",
            [getStringBytes("sfbk"), infoChunk, sdtaChunk, pdtaChunk],
            false,
            options?.enable64Bit
        );
    }
    SpessaSynthInfo(
        `%cSaved succesfully! Final file size: %c${main.length}`,
        consoleColors.info,
        consoleColors.recognized
    );
    SpessaSynthGroupEnd();
    return main;
}