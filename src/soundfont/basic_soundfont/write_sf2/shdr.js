import { IndexedByteArray } from "../../../utils/indexed_array.js";
import { writeStringAsBytes } from "../../../utils/byte_functions/string.js";
import { writeDword, writeWord, lower32, upper32 } from "../../../utils/byte_functions/little_endian.js";
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
    
    const encoder = new TextEncoder();

    let maxSampleLink = 0;

    let longName = false;

    this.samples.forEach((sample, index) =>
    {
        // sample name
        const encodedText = encoder.encode(sample.sampleName);
        if (encodedText.length <= 20)
        {
            shdrData.set(encodedText,shdrData.currentIndex);
        } 
        else if (encodedText.length <= 40)
        {
            shdrData.set(encodedText.slice(0,20),shdrData.currentIndex);
            xshdrData.set(encodedText.slice(20),xshdrData.currentIndex);
            longName = true;
        } 
        else 
        {
            shdrData.set(encodedText.slice(0,20),shdrData.currentIndex);
            xshdrData.set(encodedText.slice(20,40),xshdrData.currentIndex);
            longName = true;
        }
        shdrData.currentIndex += 20;
        xshdrData.currentIndex += 20;

        // start offset
        const dwStart = smplStartOffsets[index];
        if (enable64Bit)
        {
            writeDword(shdrData, lower32(Math.max(0, dwStart)));
            writeDword(xshdrData, upper32(Math.max(0, dwStart)));
        } else {
            writeDword(shdrData, dwStart);
        }
        xshdrData.currentIndex += 4;
        // end offset
        const dwEnd = smplEndOffsets[index];
        if (enable64Bit)
        {
            writeDword(shdrData, lower32(Math.max(0, dwEnd)));
            writeDword(xshdrData, upper32(Math.max(0, dwEnd)));
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
            writeDword(shdrData, lower32(Math.max(0, loopStart)));
            writeDword(xshdrData, upper32(Math.max(0, loopStart)));
        } else {
            writeDword(shdrData, loopStart);
        }
        if (enable64Bit)
        {
            writeDword(shdrData, lower32(Math.max(0, loopEnd)));
            writeDword(xshdrData, upper32(Math.max(0, loopEnd)));
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
    const shdr = writeRIFFChunkRaw("shdr", shdrData, false, false, enable64Bit);
    const xshdr = writeRIFFChunkRaw("shdr", xshdrData, false, false, enable64Bit);
    return {
        pdta: shdr,
        xdta: xshdr,
        xdtaToggle: longName,
        highestIndex: maxSampleLink
    };
}