import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";
import { writeWord } from "../../../utils/byte_functions/little_endian.js";
import { writeRIFFChunkRaw } from "../riff_chunk.js";

const INST_SIZE = 22;

/**
 * @this {BasicSoundBank}
 * @returns {ReturnedExtendedSf2Chunks}
 */
export function getINST(enable64Bit = false)
{
    const instSize = this.instruments.length * INST_SIZE + INST_SIZE;
    const instData = new IndexedByteArray(instSize);
    // https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md
    const xinstData = new IndexedByteArray(instSize);
    // the instrument start index is adjusted in ibag, write it here
    let instrumentStart = 0;
    for (const inst of this.instruments)
    {
        writeStringAsBytes(instData, inst.instrumentName.substring(0, 20), 20);
        writeStringAsBytes(xinstData, inst.instrumentName.substring(20), 20);
        writeWord(instData, instrumentStart & 0xFFFF);
        writeWord(xinstData, instrumentStart >> 16);
        instrumentStart += inst.instrumentZones.length + 1; // global
    }
    // write EOI
    writeStringAsBytes(instData, "EOI", 20);
    writeStringAsBytes(xinstData, "EOI", 20);
    writeWord(instData, instrumentStart & 0xFFFF);
    writeWord(xinstData, instrumentStart >> 16);
    
    const inst = writeRIFFChunkRaw("inst", instData, false, false, enable64Bit);
    const xinst = writeRIFFChunkRaw("inst", xinstData, false, false, enable64Bit);
    
    return {
        pdta: inst,
        xdta: xinst,
        highestIndex: instrumentStart
    };
}