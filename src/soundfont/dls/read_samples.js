import { findRIFFListType, readRIFFChunk } from "../basic_soundfont/riff_chunk.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import {
    SpessaSynthGroupCollapsed,
    SpessaSynthGroupEnd,
    SpessaSynthInfo,
    SpessaSynthWarn
} from "../../utils/loggin.js";
import { consoleColors } from "../../utils/other.js";
import { readLittleEndian, signedInt16 } from "../../utils/byte_functions/little_endian.js";
import { DLSSample } from "./dls_sample.js";


/**
 * @this {DLSSoundFont}
 * @param waveListChunk {RiffChunk}
 */
export function readDLSSamples(waveListChunk)
{
    SpessaSynthGroupCollapsed(
        "%cLoading Wave samples...",
        consoleColors.recognized
    );
    let sampleID = 0;
    while (waveListChunk.chunkData.currentIndex < waveListChunk.chunkData.length)
    {
        const waveChunk = readRIFFChunk(waveListChunk.chunkData);
        this.verifyHeader(waveChunk, "LIST");
        this.verifyText(readBytesAsString(waveChunk.chunkData, 4), "wave");
        
        /**
         * @type {RiffChunk[]}
         */
        const waveChunks = [];
        while (waveChunk.chunkData.currentIndex < waveChunk.chunkData.length)
        {
            waveChunks.push(readRIFFChunk(waveChunk.chunkData));
        }
        
        const fmtChunk = waveChunks.find(c => c.header === "fmt ");
        if (!fmtChunk)
        {
            throw new Error("No fmt chunk in the wave file!");
        }
        // https://github.com/tpn/winsdk-10/blob/9b69fd26ac0c7d0b83d378dba01080e93349c2ed/Include/10.0.14393.0/shared/mmreg.h#L2108
        const wFormatTag = readLittleEndian(fmtChunk.chunkData, 2);
        const channelsAmount = readLittleEndian(fmtChunk.chunkData, 2);
        if (channelsAmount !== 1)
        {
            throw new Error(`Only mono samples are supported. Fmt reports ${channelsAmount} channels`);
        }
        const sampleRate = readLittleEndian(fmtChunk.chunkData, 4);
        // skip avg bytes
        readLittleEndian(fmtChunk.chunkData, 4);
        // blockAlign
        readLittleEndian(fmtChunk.chunkData, 2);
        // it's bits per sample because one channel
        const wBitsPerSample = readLittleEndian(fmtChunk.chunkData, 2);
        const bytesPerSample = wBitsPerSample / 8;
        
        const dataChunk = waveChunks.find(c => c.header === "data");
        if (!dataChunk)
        {
            this.parsingError("No data chunk in the WAVE chunk!");
        }
        
        // read sample name
        const waveInfo = findRIFFListType(waveChunks, "INFO");
        let sampleName = `Unnamed ${sampleID}`;
        if (waveInfo)
        {
            let infoChunk = readRIFFChunk(waveInfo.chunkData);
            while (infoChunk.header !== "INAM" && waveInfo.chunkData.currentIndex < waveInfo.chunkData.length)
            {
                infoChunk = readRIFFChunk(waveInfo.chunkData);
            }
            if (infoChunk.header === "INAM")
            {
                sampleName = readBytesAsString(infoChunk.chunkData, infoChunk.size).trim();
            }
        }
        
        // correct defaults
        let sampleKey = 60;
        let samplePitch = 0;
        let sampleLoopStart = 0;
        const sampleLength = dataChunk.size / bytesPerSample;
        let sampleLoopEnd = sampleLength - 1;
        let sampleDbAttenuation = 0;
        
        // read wsmp
        const wsmpChunk = waveChunks.find(c => c.header === "wsmp");
        if (wsmpChunk)
        {
            // skip cbsize
            readLittleEndian(wsmpChunk.chunkData, 4);
            sampleKey = readLittleEndian(wsmpChunk.chunkData, 2);
            // section 1.14.2: Each relative pitch unit represents 1/65536 cents.
            // but that doesn't seem true for this one: it's just cents.
            samplePitch = signedInt16(
                wsmpChunk.chunkData[wsmpChunk.chunkData.currentIndex++],
                wsmpChunk.chunkData[wsmpChunk.chunkData.currentIndex++]
            );
            
            // pitch correction: convert hundreds to the root key
            const samplePitchSemitones = Math.trunc(samplePitch / 100);
            sampleKey += samplePitchSemitones;
            samplePitch -= samplePitchSemitones * 100;
            
            
            // gain is applied it manually here (literally multiplying the samples)
            const gainCorrection = readLittleEndian(wsmpChunk.chunkData, 4);
            // convert to signed and turn into decibels
            sampleDbAttenuation = (gainCorrection | 0) / -655360;
            // no idea about ful options
            readLittleEndian(wsmpChunk.chunkData, 4);
            const loopsAmount = readLittleEndian(wsmpChunk.chunkData, 4);
            if (loopsAmount === 1)
            {
                // skip size and type
                readLittleEndian(wsmpChunk.chunkData, 8);
                sampleLoopStart = readLittleEndian(wsmpChunk.chunkData, 4);
                const loopSize = readLittleEndian(wsmpChunk.chunkData, 4);
                sampleLoopEnd = sampleLoopStart + loopSize;
            }
        }
        else
        {
            SpessaSynthWarn("No wsmp chunk in wave... using sane defaults.");
        }
        
        this.samples.push(new DLSSample(
            sampleName,
            sampleRate,
            sampleKey,
            samplePitch,
            sampleLoopStart,
            sampleLoopEnd,
            sampleDbAttenuation,
            dataChunk,
            wFormatTag,
            bytesPerSample
        ));
        
        
        sampleID++;
        SpessaSynthInfo(
            `%cLoaded sample %c${sampleName}`,
            consoleColors.info,
            consoleColors.recognized
        );
    }
    SpessaSynthGroupEnd();
}