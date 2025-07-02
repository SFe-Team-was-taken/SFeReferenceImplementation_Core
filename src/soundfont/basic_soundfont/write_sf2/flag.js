import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeDword } from "../../../utils/byte_functions/little_endian.js";
import { writeRIFFChunkRaw } from "../riff_chunk.js";

const FLAG_SIZE = 6;
const MAX_BRANCH = 5;

/**
 * @this {BasicSoundBank}
 * @returns {ReturnedExtendedSf2Chunks}
 */
export function getFlag(enable64Bit = false)
{
    let branch = 0;
    let leaf = 0;
    let totalLeaves = 0;
    while (branch <= MAX_BRANCH)
    {
        if (this.sfeInfo["flag." + branch + "." + leaf] != undefined)
        {
            totalLeaves++;
            leaf++;
        }
        else
        {
            branch++;
            leaf = 0;
        }
    }

    const flagSize = FLAG_SIZE * totalLeaves;
    const flagData = new IndexedByteArray(flagSize);

    branch = 0;
    leaf = 0;
    while (branch <= MAX_BRANCH)
    {
        if (this.sfeInfo["flag." + branch + "." + leaf] != undefined)
        {
            flagData[flagData.currentIndex++] = branch;
            flagData[flagData.currentIndex++] = leaf;            
            writeDword(flagData, this.sfeInfo["flag." + branch + "." + leaf]);
            leaf++;
        }
        else
        {
            branch++;
            leaf = 0;
        }
    }
    
    const flag = writeRIFFChunkRaw("flag", flagData, false, false, enable64Bit);
    
    return flag;
}