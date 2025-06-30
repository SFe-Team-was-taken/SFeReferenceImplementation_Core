import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";
import { writeDword, writeWord } from "../../../utils/byte_functions/little_endian.js";
import { writeRIFFChunkRaw } from "../riff_chunk.js";
import { SF3_BIT_FLIT } from "../../read_sf2/samples.js";

/**
 * @this {BasicSoundBank}
 * @param smplStartOffsets {number[]}
 * @param smplEndOffsets {number[]}
 * @returns {ReturnedExtendedSf2Chunks}
 */
export function getSHDR(smplStartOffsets, smplEndOffsets, enable64Bit)
{
    const sampleLength = 46;
    const shdrSize = sampleLength * (this.samples.length + 1); // +1 because EOP
    const shdrData = new IndexedByteArray(shdrSize);
    // https://github.com/spessasus/soundfont-proposals/blob/main/extended_limits.md
    const xshdrData = new IndexedByteArray(shdrSize);
    let maxSampleLink = 0;
    this.samples.forEach((sample, index) =>
    {
        // sample name
        writeStringAsBytes(shdrData, sample.sampleName.substring(0, 20), 20);
        writeStringAsBytes(xshdrData, sample.sampleName.substring(20), 20);
        // start offset
        const dwStart = smplStartOffsets[index];
        if (enable64Bit)
        {
            writeDword(shdrData, Math.max(0, dwStart) & 0xFFFFFFFF);
            writeDword(xshdrData, Math.max(0, dwStart) >> 32);
        } else {
            writeDword(shdrData, dwStart);
        }
        xshdrData.currentIndex += 4;
        // end offset
        const dwEnd = smplEndOffsets[index];
        if (enable64Bit)
        {
            writeDword(shdrData, Math.max(0, dwEnd) & 0xFFFFFFFF);
            writeDword(xshdrData, Math.max(0, dwEnd) >> 32);
        } else {
            writeDword(shdrData, dwEnd);
        }
        xshdrData.currentIndex += 4;
        // loop is stored as relative in sample points, change it to absolute sample points here
        let loopStart = sample.sampleLoopStartIndex + dwStart;
        let loopEnd = sample.sampleLoopEndIndex + dwStart;
        if (sample.isCompressed)
        {
            // https://github.com/FluidSynth/fluidsynth/wiki/SoundFont3Format
            loopStart -= dwStart;
            loopEnd -= dwStart;
        }
        if (enable64Bit)
        {
            writeDword(shdrData, Math.max(0, loopStart) & 0xFFFFFFFF);
            writeDword(xshdrData, Math.max(0, loopStart) >> 32);
        } else {
            writeDword(shdrData, loopStart);
        }
        if (enable64Bit)
        {
            writeDword(shdrData, Math.max(0, loopEnd) & 0xFFFFFFFF);
            writeDword(xshdrData, Math.max(0, loopEnd) >> 32);
        } else {
            writeDword(shdrData, loopEnd);
        }
        // sample rate
        writeDword(shdrData, sample.sampleRate);
        // pitch and correction
        shdrData[shdrData.currentIndex++] = sample.samplePitch;
        shdrData[shdrData.currentIndex++] = sample.samplePitchCorrection;
        // skip all those for xshdr
        xshdrData.currentIndex += 14;
        // sample link
        const sampleLinkIndex = this.samples.indexOf(sample.linkedSample);
        writeWord(shdrData, Math.max(0, sampleLinkIndex) & 0xFFFF);
        writeWord(xshdrData, Math.max(0, sampleLinkIndex) >> 16);
        maxSampleLink = Math.max(maxSampleLink, sampleLinkIndex);
        // sample type: add byte if compressed
        let type = sample.sampleType;
        if (sample.isCompressed)
        {
            type |= SF3_BIT_FLIT;
        }
        writeWord(shdrData, type);
        xshdrData.currentIndex += 2;
    });
    
    // write EOS and zero everything else
    writeStringAsBytes(shdrData, "EOS", sampleLength);
    writeStringAsBytes(xshdrData, "EOS", sampleLength);
    const shdr = writeRIFFChunkRaw("shdr", shdrData, enable64Bit);
    const xshdr = writeRIFFChunkRaw("shdr", xshdrData, enable64Bit);
    return {
        pdta: shdr,
        xdta: xshdr,
        highestIndex: maxSampleLink
    };
}