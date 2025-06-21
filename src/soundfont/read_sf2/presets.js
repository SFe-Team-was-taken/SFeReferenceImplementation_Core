import { RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import { BasicPreset } from "../basic_soundfont/basic_preset.js";
import { PresetZone } from "./preset_zones.js";
import { consoleColors } from "../../utils/other.js";
import { SpessaSynthInfo } from "../../utils/loggin.js";
import { isValidXGMSB } from "../../utils/xg_hacks.js";

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
     * @param emptyPreset {boolean}
     */
    constructor(presetChunk, sf2, emptyPreset = false)
    {
        super(sf2);
        if (!emptyPreset)
        {
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
    let ifilVersionText = parent.soundFontInfo["ifil.wMajor"] + '.' + parent.soundFontInfo["ifil.wMinor"];
    let sfeVersionText;
    SpessaSynthInfo(`%cThe preset reader detects ifil version: %c${ifilVersionText}`,
                                consoleColors.info,
                                consoleColors.recognized);
    if (parent.soundFontInfo["ifil.wMajor"] >= 2 && parent.soundFontInfo["ifil.wMinor"] >= 1024) // SFe detected, for some reason strict equals doesn't work
    {
        sfeVersionText = parent.sfeInfo["SFvx.wSFeSpecMajorVersion"] + '.' + parent.sfeInfo["SFvx.wSFeSpecMinorVersion"];
        SpessaSynthInfo(`%cThe preset reader detects SFe extended version: %c${sfeVersionText}`,
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
        // console.log(preset);
        if (parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024) // Must be SF2 and not an XG (or GM2) MSB.
        {
            if (isValidXGMSB(preset.bank) == false && preset.bank !== 0)
            {
                let shadowPreset = new Preset(presetChunk, parent, true);
                shadowPreset = Object.assign(shadowPreset, preset);
                shadowPreset.presetName = shadowPreset.presetName + " (LSB)";
                shadowPreset.bankLSB = shadowPreset.bank;
                shadowPreset.bank = 0;
                presets.push(shadowPreset);
                // console.log(shadowPreset);
            }
        }
    }
    // remove EOP
    presets.pop();
    if (((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024)) && presets[presets.length - 1].presetName == "EOP") // Must be SF2 and not an XG (or GM2) MSB.
    {
        presets.pop(); // eop is copied and then removed (in the rare edge case that bank of eop is non-zero)
    }
    
    let msb127Found = false;
    presets.forEach(p => 
        {
        if (p.bank == 127)
        {
            msb127Found = true;
        }
    }
    );

    if (!msb127Found) 
    {
        let shadowDrumPreset;
        presets.forEach(p =>
            {
                if (p.bank == 128)
                {
                    shadowDrumPreset = new Preset(presetChunk, parent, true);
                    shadowDrumPreset = Object.assign(shadowDrumPreset, p);
                    shadowDrumPreset.presetName = shadowDrumPreset.presetName + " (127)";
                    shadowDrumPreset.bank = 127;
                    presets.push(shadowDrumPreset);
                }
            }
        )
    }

    if (((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024)) && presets[presets.length - 1].presetName == "EOP") // Must be SF2 and not an XG (or GM2) MSB.
    {
        presets.pop(); // eop is copied and then removed (in the rare edge case that bank of eop is non-zero)
    }
    
    console.log(presets);


    return presets;
}


/**
 * Duplicate a preset
 * @param preset {Preset}
 * @returns {Preset} 
 */
export function duplicatePreset(preset)
{
    return 1;
}