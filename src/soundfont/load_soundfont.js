import { IndexedByteArray } from "../utils/indexed_array.js";
import { readBytesAsString } from "../utils/byte_functions/string.js";
import { DLSSoundFont } from "./dls/dls_soundfont.js";
import { SoundFont2 } from "./read_sf2/soundfont.js";

/**
 * Loads a soundfont or dls file
 * @param buffer {ArrayBuffer} the binary file to load
 * @param presetShadowing {boolean} enable preset shadowing
 * @returns {BasicSoundBank}
 */
export function loadSoundFont(buffer, presetShadowing = true)
{
    const check = buffer.slice(8, 12);
    const a = new IndexedByteArray(check);
    const id = readBytesAsString(a, 4, false).toLowerCase();
    if (id === "dls ")
    {
        return new DLSSoundFont(buffer);
    }
    return new SoundFont2(buffer, false, presetShadowing);
}