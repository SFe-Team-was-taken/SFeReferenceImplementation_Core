import { IndexedByteArray } from "../../../utils/indexed_array";
import { writeBinaryStringIndexed } from "../../../utils/byte_functions/string";
import {
    writeDword,
    writeWord
} from "../../../utils/byte_functions/little_endian";
import { writeRIFFChunkRaw } from "../../../utils/riff_chunk";
import { SF3_BIT_FLIT } from "../read/samples";
import type { BasicSoundBank } from "../../basic_soundbank/basic_soundbank";

import type { ExtendedSF2Chunks } from "./types";

export function getSHDR(
    bank: BasicSoundBank,
    smplStartOffsets: number[],
    smplEndOffsets: number[]
): ExtendedSF2Chunks {
    const sampleLength = 46;
    const shdrSize = sampleLength * (bank.samples.length + 1); // +1 because EOP
    const shdrData = new IndexedByteArray(shdrSize);
    // https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md
    const xshdrData = new IndexedByteArray(shdrSize);
    const encoder = new TextEncoder();
    let maxSampleLink = 0;
    bank.samples.forEach((sample, index) => {
        const encodedText = encoder.encode(sample.name);
        if (encodedText.length <= 20)
        {
            shdrData.set(encodedText,shdrData.currentIndex);
        } 
        else if (encodedText.length <= 40)
        {
            shdrData.set(encodedText.slice(0,20),shdrData.currentIndex);
            xshdrData.set(encodedText.slice(20),xshdrData.currentIndex);
        } 
        else 
        {
            shdrData.set(encodedText.slice(0,20),shdrData.currentIndex);
            xshdrData.set(encodedText.slice(20,40),xshdrData.currentIndex);
        }
        shdrData.currentIndex += 20;
        xshdrData.currentIndex += 20;
        // Start offset
        const dwStart = smplStartOffsets[index];
        writeDword(shdrData, dwStart);
        xshdrData.currentIndex += 4;
        // End offset
        const dwEnd = smplEndOffsets[index];
        writeDword(shdrData, dwEnd);
        xshdrData.currentIndex += 4;
        // Loop is stored as relative in sample points, change it to absolute sample points here
        let loopStart = sample.loopStart + dwStart;
        let loopEnd = sample.loopEnd + dwStart;
        if (sample.isCompressed) {
            // https://github.com/FluidSynth/fluidsynth/wiki/SoundFont3Format
            loopStart -= dwStart;
            loopEnd -= dwStart;
        }
        writeDword(shdrData, loopStart);
        writeDword(shdrData, loopEnd);
        // Sample rate
        writeDword(shdrData, sample.sampleRate);
        // Pitch and correction
        shdrData[shdrData.currentIndex++] = sample.originalKey;
        shdrData[shdrData.currentIndex++] = sample.pitchCorrection;
        // Skip all those for xshdr
        xshdrData.currentIndex += 14;
        // Sample link
        const sampleLinkIndex = sample.linkedSample
            ? bank.samples.indexOf(sample.linkedSample)
            : 0;
        writeWord(shdrData, Math.max(0, sampleLinkIndex) & 0xffff);
        writeWord(xshdrData, Math.max(0, sampleLinkIndex) >> 16);
        maxSampleLink = Math.max(maxSampleLink, sampleLinkIndex);
        // Sample type: add byte if compressed
        let type = sample.sampleType;
        if (sample.isCompressed) {
            type |= SF3_BIT_FLIT;
        }
        writeWord(shdrData, type);
        xshdrData.currentIndex += 2;
    });

    // Write EOS and zero everything else
    writeBinaryStringIndexed(shdrData, "EOS", sampleLength);
    writeBinaryStringIndexed(xshdrData, "EOS", sampleLength);
    const shdr = writeRIFFChunkRaw("shdr", shdrData);
    const xshdr = writeRIFFChunkRaw("shdr", xshdrData);
    return {
        pdta: shdr,
        xdta: xshdr
    };
}
