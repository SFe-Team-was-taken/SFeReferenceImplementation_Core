import { combineArrays, IndexedByteArray } from "../../../utils/indexed_array.js";
import { RiffChunk, writeRIFFChunk, writeRIFFOddSize } from "../riff_chunk.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";
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
import { writeLittleEndian, writeWord } from "../../../utils/byte_functions/little_endian.js";
import { SpessaSynthGroupCollapsed, SpessaSynthGroupEnd, SpessaSynthInfo } from "../../../utils/loggin.js";
import { MOD_BYTE_SIZE } from "../modulator.js";
import { fillWithDefaults } from "../../../utils/fill_with_defaults.js";
/**
 * @typedef {Object} SoundFont2WriteOptions
 * @property {boolean|undefined} compress - if the soundfont should be compressed with the Ogg Vorbis codec
 * @property {number|undefined} compressionQuality - the vorbis compression quality, from -0.1 to 1
 * @property {EncodeVorbisFunction|undefined} compressionFunction -
 * the encode vorbis function. Can be undefined if not compressed.
 * @property {boolean|undefined} writeDefaultModulators - if the DMOD chunk should be written.
 * Recommended.
 */

/**
 * @type {SoundFont2WriteOptions}
 */
const DEFAULT_WRITE_OPTIONS = {
    compress: false,
    compressionQuality: 0.5,
    compressionFunction: undefined,
    writeDefaultModulators: true
};

/**
 * Write the soundfont as an .sf2 file
 * @this {BasicSoundBank}
 * @param {SoundFont2WriteOptions} options
 * @returns {Uint8Array}
 */
export function write(options = DEFAULT_WRITE_OPTIONS)
{
    options = fillWithDefaults(options, DEFAULT_WRITE_OPTIONS);
    if (options.compress)
    {
        if (typeof options.compressionFunction !== "function")
        {
            throw new TypeError("No compression function supplied but compression enabled.");
        }
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
    if (options?.compress)
    {
        this.soundFontInfo["ifil"] = "3.0"; // set version to 3
    }
    
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
            infoArrays.push(writeRIFFChunk(new RiffChunk(
                type,
                4,
                ckdata
            )));
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
            
            infoArrays.push(writeRIFFChunk(new RiffChunk(
                type,
                dmoddata.length,
                dmoddata
            )));
        }
        else
        {
            // pad with zero
            const arr = new IndexedByteArray(data.length + 1);
            writeStringAsBytes(arr, data);
            infoArrays.push(writeRIFFChunk(new RiffChunk(
                type,
                arr.length,
                arr
            )));
        }
    }
    const infoChunk = writeRIFFOddSize("INFO", combineArrays(infoArrays), false, true);
    
    SpessaSynthInfo(
        "%cWriting SDTA...",
        consoleColors.info
    );
    // write sdta
    const smplStartOffsets = [];
    const smplEndOffsets = [];
    const sdtaChunk = getSDTA.call(
        this,
        smplStartOffsets,
        smplEndOffsets,
        options?.compress,
        options?.compressionQuality ?? 0.5,
        options.compressionFunction
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
    const shdrChunk = getSHDR.call(this, smplStartOffsets, smplEndOffsets);
    SpessaSynthInfo(
        "%cWriting IGEN...",
        consoleColors.info
    );
    const igenChunk = getIGEN.call(this);
    SpessaSynthInfo(
        "%cWriting IMOD...",
        consoleColors.info
    );
    const imodChunk = getIMOD.call(this);
    SpessaSynthInfo(
        "%cWriting IBAG...",
        consoleColors.info
    );
    const ibagChunk = getIBAG.call(this);
    SpessaSynthInfo(
        "%cWriting INST...",
        consoleColors.info
    );
    const instChunk = getINST.call(this);
    // presets
    const pgenChunk = getPGEN.call(this);
    SpessaSynthInfo(
        "%cWriting PMOD...",
        consoleColors.info
    );
    const pmodChunk = getPMOD.call(this);
    SpessaSynthInfo(
        "%cWriting PBAG...",
        consoleColors.info
    );
    const pbagChunk = getPBAG.call(this);
    SpessaSynthInfo(
        "%cWriting PHDR...",
        consoleColors.info
    );
    const phdrChunk = getPHDR.call(this);
    // combine in the sfspec order
    const pdtadata = combineArrays([
        new IndexedByteArray([112, 100, 116, 97]), // "pdta"
        phdrChunk,
        pbagChunk,
        pmodChunk,
        pgenChunk,
        instChunk,
        ibagChunk,
        imodChunk,
        igenChunk,
        shdrChunk
    ]);
    const pdtaChunk = writeRIFFChunk(new RiffChunk(
        "LIST",
        pdtadata.length,
        pdtadata
    ));
    SpessaSynthInfo(
        "%cWriting the output file...",
        consoleColors.info
    );
    // finally, combine everything
    const riffdata = combineArrays([
        new IndexedByteArray([115, 102, 98, 107]), // "sfbk"
        infoChunk,
        sdtaChunk,
        pdtaChunk
    ]);
    
    const main = writeRIFFChunk(new RiffChunk(
        "RIFF",
        riffdata.length,
        riffdata
    ));
    SpessaSynthInfo(
        `%cSaved succesfully! Final file size: %c${main.length}`,
        consoleColors.info,
        consoleColors.recognized
    );
    SpessaSynthGroupEnd();
    return main;
}