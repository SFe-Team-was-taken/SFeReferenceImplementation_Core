import { RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import { BasicPreset } from "../basic_soundfont/basic_preset.js";
import { PresetZone } from "./preset_zones.js";
import { consoleColors } from "../../utils/other.js";
import { SpessaSynthInfo } from "../../utils/loggin.js";

/**
 * parses soundfont presets, also includes function for getting the generators and samples from midi note and velocity
 */

export class Preset extends BasicPreset
{
    
    /**
     * @type {number}
     */
    zoneStartIndex;
    /**
     * @type {number}
     */
    zonesCount = 0;
    
    /**
     * Creates a preset
     * @param presetChunk {RiffChunk}
     * @param sf2 {BasicSoundBank}
     */
    constructor(presetChunk, sf2)
    {
        super(sf2);
        this.presetName = readBytesAsString(presetChunk.chunkData, 20)
            .replace(/\d{3}:\d{3}/, ""); // remove those pesky "000:001"
        
        this.program = readLittleEndian(presetChunk.chunkData, 2);
        this.bank = readLittleEndian(presetChunk.chunkData, 1); // Bank MSB is only first byte
        this.bankLSB = readLittleEndian(presetChunk.chunkData, 1); // Bank LSB is second byte
        this.zoneStartIndex = readLittleEndian(presetChunk.chunkData, 2);
        
        // read the dword
        this.library = readLittleEndian(presetChunk.chunkData, 4);
        this.genre = readLittleEndian(presetChunk.chunkData, 4);
        this.morphology = readLittleEndian(presetChunk.chunkData, 4);
        // console.log(`${this.bank}:${this.bankLSB}:${this.program} at ${this.zoneStartIndex}: ${this.presetName}`);
    }
    
    /**
     * @returns {PresetZone}
     */
    createZone()
    {
        const z = new PresetZone(this);
        this.presetZones.push(z);
        return z;
    }
}

/**
 * Reads the presets
 * @param presetChunk {RiffChunk}
 * @param parent {BasicSoundBank}
 * @returns {Preset[]}
 */
export function readPresets(presetChunk, parent)
{
    /**
     * @type {Preset[]}
     */
    let presets = [];
    SpessaSynthInfo(`%cThe preset reader detects ifil version: %c${parent.soundFontInfo["ifil.wMajor"]}.${parent.soundFontInfo["ifil.wMinor"]}`,
                                consoleColors.info,
                                consoleColors.recognized);
    if (parent.soundFontInfo["ifil.wMajor"] == 2 && parent.soundFontInfo["ifil.wMinor"] >= 1024) // SFe detected, for some reason strict equals doesn't work
    {
        SpessaSynthInfo(`%cThe preset reader detects SFe extended version: %c${parent.sfeInfo["SFvx.wSFeSpecMajorVersion"]}.${parent.sfeInfo["SFvx.wSFeSpecMinorVersion"]}`,
                                consoleColors.info,
                                consoleColors.recognized);
    }

    while (presetChunk.chunkData.length > presetChunk.chunkData.currentIndex)
    {
        let preset = new Preset(presetChunk, parent);
        if (presets.length > 0)
        {
            const previous = presets[presets.length - 1];
            previous.zonesCount = preset.zoneStartIndex - previous.zoneStartIndex;
        }
        presets.push(preset);
    }
    // remove EOP
    presets.pop();
    return presets;
}