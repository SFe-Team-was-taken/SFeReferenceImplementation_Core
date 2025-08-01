import { RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readLittleEndian } from "../../utils/byte_functions/little_endian.js";
import { decodeUtf8 } from "../../utils/byte_functions/string.js";
import { BasicInstrument } from "../basic_soundfont/basic_instrument.js";

import { InstrumentZone } from "./instrument_zones.js";

/**
 * instrument.js
 * purpose: parses soundfont instrument and stores them as a class
 */

export class Instrument extends BasicInstrument
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
     * Creates an instrument
     * @param instrumentChunk {RiffChunk}
     */
    constructor(instrumentChunk, useXdta = false, xdtaChunk = undefined)
    {
        super();

        let instNameArray = new IndexedByteArray(40);
        instNameArray.set(instrumentChunk.chunkData.slice(instrumentChunk.chunkData.currentIndex, instrumentChunk.chunkData.currentIndex + 20), 0)
        instrumentChunk.chunkData.currentIndex += 20;
        if (useXdta)
        {
            instNameArray.set(xdtaChunk.chunkData.slice(xdtaChunk.chunkData.currentIndex, xdtaChunk.chunkData.currentIndex + 20), 20);
            xdtaChunk.chunkData.currentIndex += 20;
        }
        this.instrumentName = decodeUtf8(instNameArray);

        this.zoneStartIndex = readLittleEndian(instrumentChunk.chunkData, 2);
        if (useXdta)
        {
            let xZoneStartIndex = readLittleEndian(xdtaChunk.chunkData, 2);
            this.zoneStartIndex += xZoneStartIndex << 16;
        }
    }
    
    /**
     * @returns {InstrumentZone}
     */
    createZone()
    {
        const z = new InstrumentZone(this);
        this.instrumentZones.push(z);
        return z;
    }
}

/**
 * Reads the instruments
 * @param instrumentChunk {RiffChunk}
 * @returns {Instrument[]}
 */
export function readInstruments(instrumentChunk, useXdta = false, xdtaChunk = undefined)
{
    /**
     * @type {Instrument[]}
     */
    let instruments = [];
    let xdtaValid = false;
    if (useXdta)
    {
        xdtaValid = instrumentChunk.size == xdtaChunk.size;
    }
    while (instrumentChunk.chunkData.length > instrumentChunk.chunkData.currentIndex)
    {
        let instrument = new Instrument(instrumentChunk, xdtaValid, xdtaChunk);
        
        if (instruments.length > 0)
        {
            const previous = instruments[instruments.length - 1];
            previous.zonesCount = instrument.zoneStartIndex - previous.zoneStartIndex;
        }
        instruments.push(instrument);
    }
    // remove EOI
    instruments.pop();
    return instruments;
}