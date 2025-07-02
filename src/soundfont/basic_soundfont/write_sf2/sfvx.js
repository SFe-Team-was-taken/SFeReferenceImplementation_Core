import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeWord } from "../../../utils/byte_functions/little_endian.js";
import { writeRIFFChunkRaw } from "../riff_chunk.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";

/**
 * @this {BasicSoundBank}
 * @returns {ReturnedExtendedSf2Chunks}
 */
export function getSFvx(enable64Bit = false)
{
    const sfvxSize = 46; // Always 46 bytes in length as of ver.4.0
    const sfvxData = new IndexedByteArray(sfvxSize);
    writeWord(sfvxData, this.sfeInfo["SFvx.wSFeSpecMajorVersion"]);
    writeWord(sfvxData, this.sfeInfo["SFvx.wSFeSpecMinorVersion"]);
    writeStringAsBytes(sfvxData, this.sfeInfo["SFvx.achSFeSpecType"], 20);
    writeWord(sfvxData, this.sfeInfo["SFvx.wSFeDraftMilestone"])
    writeStringAsBytes(sfvxData, this.sfeInfo["SFvx.achSFeFullVersion"], 20);

    const sfvx = writeRIFFChunkRaw("SFvx", sfvxData, false, false, enable64Bit);

    return sfvx;
}