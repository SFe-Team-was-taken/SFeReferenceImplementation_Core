import { writeRIFFChunkRaw } from "../riff_chunk.js";
import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";

/**
 * @this {BasicSoundBank}
 * @returns {ReturnedExtendedSf2Chunks}
 */
export function getSFty(enable64Bit = false)
{
    let sftySize = this.sfeInfo["SFty"].length + 1; // Must be padded by at least one byte.
    if (sftySize % 2 == 1)
    {
        sftySize++; // If originally even, make it even again with 2 pad bytes.
    }
    
    const sftyData = new IndexedByteArray(sftySize);
    writeStringAsBytes(sftyData, this.sfeInfo["SFty"]);

    const sfty = writeRIFFChunkRaw("SFty", sftyData, false, false, enable64Bit);

    return sfty;
}