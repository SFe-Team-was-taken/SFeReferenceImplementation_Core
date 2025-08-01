import { RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { decodeUtf8 } from "../../utils/byte_functions/string.js";
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
     * @param useXdta {boolean}
     * @param xdtaChunk {RiffChunk}
     */
    constructor(presetChunk, sf2, emptyPreset = false, useXdta = false, xdtaChunk = undefined)
    {
        super(sf2);
        if (!emptyPreset)
        {
            let presetNameArray = new IndexedByteArray(40);
            presetNameArray.set(presetChunk.chunkData.slice(presetChunk.chunkData.currentIndex, presetChunk.chunkData.currentIndex + 20), 0);
            presetChunk.chunkData.currentIndex += 20;
            if (useXdta)
            {
                presetNameArray.set(xdtaChunk.chunkData.slice(xdtaChunk.chunkData.currentIndex, xdtaChunk.chunkData.currentIndex + 20), 20);
                xdtaChunk.chunkData.currentIndex += 20;
            }

            
            if (decodeUtf8(presetNameArray))
            {
                this.presetName = decodeUtf8(presetNameArray)
                .replace(/\d{3}:\d{3}/, ""); // remove those pesky "000:001"
            }
            else
            {
                this.presetName = "Undefined";
            }
            
            this.program = readLittleEndian(presetChunk.chunkData, 2);
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 2;
            }
            
            this.bank = readLittleEndian(presetChunk.chunkData, 1); // Bank MSB is only first byte
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 1;
            }

            this.bankLSB = readLittleEndian(presetChunk.chunkData, 1); // Bank LSB is second byte
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 1;
            }            
            
            this.zoneStartIndex = readLittleEndian(presetChunk.chunkData, 2);
            if (useXdta)
            {
                let xZoneStartIndex = readLittleEndian(xdtaChunk.chunkData, 2);
                this.zoneStartIndex += xZoneStartIndex << 16;
            }
            
            // read the dword
            this.library = readLittleEndian(presetChunk.chunkData, 4);
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 4;
            }
            this.genre = readLittleEndian(presetChunk.chunkData, 4);
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 4;
            }
            this.morphology = readLittleEndian(presetChunk.chunkData, 4);
            if (useXdta)
            {
                xdtaChunk.chunkData.currentIndex += 4;
            }
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
 * @param useXdta {boolean}
 * @param xdtaChunk {RiffChunk}
 * @param shadowPresets {boolean}
 * @returns {Preset[]}
 */
export function readPresets(presetChunk, parent, useXdta = false, xdtaChunk = undefined, shadowPresets = true)
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

    let xdtaValid = false;
    if (useXdta)
    {
        xdtaValid = presetChunk.size == xdtaChunk.size;
    }

    while (presetChunk.chunkData.length > presetChunk.chunkData.currentIndex)
    {
        let preset = new Preset(presetChunk, parent, false, xdtaValid, xdtaChunk);
        if (presets.length > 0)
        {
            const previous = presets[presets.length - 1];
            previous.zonesCount = preset.zoneStartIndex - previous.zoneStartIndex;
        }
        presets.push(preset);
        // console.log(preset);
        if ((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024) && (shadowPresets)) // Must be SF2 and not an XG (or GM2) MSB.
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
    if ((((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024)) && presets[presets.length - 1].presetName == "EOP") && (shadowPresets)) // Must be SF2 and not an XG (or GM2) MSB.
    {
        presets.pop(); // eop is copied and then removed (in the rare edge case that bank of eop is non-zero)
    }

    if ((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024) && (shadowPresets)) // Must be SF2 and not an XG (or GM2) MSB.
    {
        let msb127Found = false;
        let msb120Found = false;
        presets.forEach(p => 
            {
            if (p.bank == 127)
            {
                msb127Found = true;
            } else if (p.bank == 120) {
                msb120Found = true;
            }
        }
        );

        if (!msb127Found) 
        {
            let shadow127DrumPreset;
            presets.forEach(p =>
                {
                    if (p.bank == 128)
                    {
                        shadow127DrumPreset = new Preset(presetChunk, parent, true);
                        shadow127DrumPreset = Object.assign(shadow127DrumPreset, p);
                        shadow127DrumPreset.presetName = shadow127DrumPreset.presetName + " (127)";
                        shadow127DrumPreset.bank = 127;
                        presets.push(shadow127DrumPreset);
                    }
                }
            )
        }
        if (!msb120Found) 
        {
            let shadow120DrumPreset;
            presets.forEach(p =>
                {
                    if (p.bank == 128)
                    {
                        shadow120DrumPreset = new Preset(presetChunk, parent, true);
                        shadow120DrumPreset = Object.assign(shadow120DrumPreset, p);
                        shadow120DrumPreset.presetName = shadow120DrumPreset.presetName + " (120)";
                        shadow120DrumPreset.bank = 120;
                        presets.push(shadow120DrumPreset);
                    }
                }
            )
        }
    }

    if ((((parent.soundFontInfo["ifil.wMajor"] < 2 || parent.soundFontInfo["ifil.wMinor"] < 1024)) && presets[presets.length - 1].presetName == "EOP") && (shadowPresets)) // Must be SF2 and not an XG (or GM2) MSB.
    {
        presets.pop(); // eop is copied and then removed (in the rare edge case that bank of eop is non-zero)
    }

    return presets;
}