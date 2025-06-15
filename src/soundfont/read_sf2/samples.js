import { RiffChunk } from "../basic_soundfont/riff_chunk.js";
import { IndexedByteArray } from "../../utils/indexed_array.js";
import { readLittleEndian, signedInt8 } from "../../utils/byte_functions/little_endian.js";
import { stbvorbis } from "../../externals/stbvorbis_sync/stbvorbis_sync.min.js";
import { SpessaSynthWarn } from "../../utils/loggin.js";
import { readBytesAsString } from "../../utils/byte_functions/string.js";
import { BasicSample } from "../basic_soundfont/basic_sample.js";

export const SF3_BIT_FLIT = 0x10;

export class SoundFontSample extends BasicSample
{
    /**
     * Linked sample index for retrieving linked samples in sf2
     * @type {number}
     */
    linkedSampleIndex;
    
    /**
     * Creates a sample
     * @param sampleName {string}
     * @param sampleStartIndex {number}
     * @param sampleEndIndex {number}
     * @param sampleLoopStartIndex {number}
     * @param sampleLoopEndIndex {number}
     * @param sampleRate {number}
     * @param samplePitch {number}
     * @param samplePitchCorrection {number}
     * @param linkedSampleIndex {number}
     * @param sampleType {number}
     * @param smplArr {IndexedByteArray|Float32Array}
     * @param sampleIndex {number} initial sample index when loading the sfont
     * @param isDataRaw {boolean} if false, the data is decoded as float32.
     * Used for SF2Pack support
     */
    constructor(
        sampleName,
        sampleStartIndex,
        sampleEndIndex,
        sampleLoopStartIndex,
        sampleLoopEndIndex,
        sampleRate,
        samplePitch,
        samplePitchCorrection,
        linkedSampleIndex,
        sampleType,
        smplArr,
        sampleIndex,
        isDataRaw
    )
    {
        // read sf3
        // https://github.com/FluidSynth/fluidsynth/wiki/SoundFont3Format
        const compressed = (sampleType & SF3_BIT_FLIT) > 0;
        // remove the compression flag
        sampleType &= ~SF3_BIT_FLIT;
        super(
            sampleName,
            sampleRate,
            samplePitch,
            samplePitchCorrection,
            sampleType,
            sampleLoopStartIndex - (sampleStartIndex / 2),
            sampleLoopEndIndex - (sampleStartIndex / 2)
        );
        this.isCompressed = compressed;
        this.sampleName = sampleName;
        // in bytes
        this.sampleStartIndex = sampleStartIndex;
        this.sampleEndIndex = sampleEndIndex;
        this.isSampleLoaded = false;
        this.sampleID = sampleIndex;
        // in bytes
        this.sampleLength = this.sampleEndIndex - this.sampleStartIndex;
        this.sampleDataArray = smplArr;
        this.sampleData = new Float32Array(0);
        if (this.isContainerised)
        {
            // correct loop points
            this.sampleLoopStartIndex += this.sampleStartIndex / 2;
            this.sampleLoopEndIndex += this.sampleStartIndex / 2;
            this.sampleLength = 99999999; // set to 999,999 before we decode it
        }
        this.isDataRaw = isDataRaw;
        this.linkedSampleIndex = linkedSampleIndex;
    }
    
    /**
     * @param samplesArray {BasicSample[]}
     */
    getLinkedSample(samplesArray)
    {
        if (this.linkedSample || !this.isLinked)
        {
            return;
        }
        this.setLinkedSample(samplesArray[this.linkedSampleIndex], this.sampleType);
    }
    
    /**
     * Get raw data, whether it's compressed or not as we simply write it to the file
     * @return {Uint8Array} either s16 or vorbis data
     */
    getRawData()
    {
        const smplArr = this.sampleDataArray;
        if (this.isContainerised)
        {
            if (this.containerisedData)
            {
                return this.containerisedData;
            }
            const smplStart = smplArr.currentIndex;
            return smplArr.slice(this.sampleStartIndex / 2 + smplStart, this.sampleEndIndex / 2 + smplStart);
        }
        else
        {
            if (!this.isDataRaw)
            {
                // encode the f32 into s16 manually
                super.getRawData();
            }
            const dataStartIndex = smplArr.currentIndex;
            return smplArr.slice(dataStartIndex + this.sampleStartIndex, dataStartIndex + this.sampleEndIndex);
        }
    }
    
    /**
     * Decode binary vorbis into a float32 pcm
     */
    decodeVorbis()
    {
        if (this.sampleLength < 1)
        {
            // eos, do not do anything
            return;
        }
        // get the compressed byte stream
        const smplArr = this.sampleDataArray;
        const smplStart = smplArr.currentIndex;
        const buff = smplArr.slice(this.sampleStartIndex / 2 + smplStart, this.sampleEndIndex / 2 + smplStart);
        // reset array and being decoding
        this.sampleData = new Float32Array(0);
        try
        {
            /**
             * @type {{data: Float32Array[], error: (string|null), sampleRate: number, eof: boolean}}
             */
            const vorbis = stbvorbis.decode(buff.buffer);
            this.sampleData = vorbis.data[0];
            if (this.sampleData === undefined)
            {
                SpessaSynthWarn(`Error decoding sample ${this.sampleName}: Vorbis decode returned undefined.`);
            }
        }
        catch (e)
        {
            // do not error out, fill with silence
            SpessaSynthWarn(`Error decoding sample ${this.sampleName}: ${e}`);
            this.sampleData = new Float32Array(this.sampleLoopEndIndex + 1);
        }
    }
    
    /**
     * @param audioData {Float32Array}
     */
    setAudioData(audioData)
    {
        super.setAudioData(audioData);
        this.isSampleLoaded = true;
        this.isDataRaw = false;
    }
    
    /**
     * Loads the audio data and stores it for reuse
     * @returns {Float32Array} The audioData
     */
    getAudioData()
    {
        if (!this.isSampleLoaded)
        {
            // start loading data if it is not loaded
            if (this.sampleLength < 1)
            {
                SpessaSynthWarn(`Invalid sample ${this.sampleName}! Invalid length: ${this.sampleLength}`);
                return new Float32Array(1);
            }
            
            if (this.isContainerised) 
            {

                let rawData = this.getRawData();
                let fourcc = readBytesAsString(rawData, 4);
                if (fourcc == "OggS")
                {
                    let oggHeader = readBytesAsString(rawData, 23);
                    let pageSegs = rawData[26];
                    let segTable = readBytesAsString(rawData, pageSegs);
                    let formatID = rawData.slice(27+pageSegs,37+pageSegs); // Todo: replace with proper identification of vorbis format
                    let formatIDTrimmed = formatID.slice(1, 10);
                    let formatIDString = readBytesAsString(formatID, 10);
                    let formatIDStringTrimmed = readBytesAsString(formatIDTrimmed, 9);
                    // SpessaSynthWarn(formatID);
                    if (formatID[0] == 1)
                    {
                        if (formatIDStringTrimmed.slice(0, 6) == "vorbis")
                        {
                            this.compressionType = 1;
                        } 
                    } else if (formatIDString.slice(0, 8) == "OpusHead")
                    {
                        this.compressionType = 2;
                    } // Flac and wav detection later
                }
                if (this.compressionType == 1)
                {
                    // if compressed, decode
                    this.decodeVorbis();
                    this.isSampleLoaded = true;
                    return this.sampleData;
                } else 
                {
                    SpessaSynthWarn(`Invalid sample ${this.sampleName}! (Invalid) length: ${this.sampleLength}, compression type ID: ${this.compressionType}`);
                    return new Float32Array(1);
                }
            }
            else if (!this.isDataRaw)
            {
                return this.getUncompressedReadyData();
            }
            return this.loadUncompressedData();
        }
        return this.sampleData;
    }
    
    /**
     * @returns {Float32Array}
     */
    loadUncompressedData()
    {
        if (this.isContainerised)
        {
            SpessaSynthWarn("Trying to load a containerised sample via loadUncompressedData()... aborting!");
            return new Float32Array(0);
        }
        
        // read the sample data
        let audioData = new Float32Array(this.sampleLength / 2);
        const dataStartIndex = this.sampleDataArray.currentIndex;
        let convertedSigned16 = new Int16Array(
            this.sampleDataArray.slice(dataStartIndex + this.sampleStartIndex, dataStartIndex + this.sampleEndIndex)
                .buffer
        );
        
        // convert to float
        for (let i = 0; i < convertedSigned16.length; i++)
        {
            audioData[i] = convertedSigned16[i] / 32768;
        }
        
        this.sampleData = audioData;
        this.isSampleLoaded = true;
        return audioData;
    }
    
    /**
     * @returns {Float32Array}
     */
    getUncompressedReadyData()
    {
        /**
         * read the sample data
         * @type {Float32Array}
         */
        let audioData = /**@type {Float32Array}*/ this.sampleDataArray.slice(
            this.sampleStartIndex / 2,
            this.sampleEndIndex / 2
        );
        this.sampleData = audioData;
        this.isSampleLoaded = true;
        return audioData;
    }
}

/**
 * Reads the generatorTranslator from the shdr read
 * @param sampleHeadersChunk {RiffChunk}
 * @param smplChunkData {IndexedByteArray|Float32Array}
 * @param isSmplDataRaw {boolean}
 * @returns {SoundFontSample[]}
 */
export function readSamples(sampleHeadersChunk, smplChunkData, isSmplDataRaw = true)
{
    /**
     * @type {SoundFontSample[]}
     */
    let samples = [];
    let index = 0;
    while (sampleHeadersChunk.chunkData.length > sampleHeadersChunk.chunkData.currentIndex)
    {
        const sample = readSample(index, sampleHeadersChunk.chunkData, smplChunkData, isSmplDataRaw);
        samples.push(sample);
        index++;
    }
    // remove EOS
    samples.pop();
    
    // link samples
    samples.forEach(s => s.getLinkedSample(samples));
    
    return samples;
}

/**
 * Reads it into a sample
 * @param index {number}
 * @param sampleHeaderData {IndexedByteArray}
 * @param smplArrayData {IndexedByteArray|Float32Array}
 * @param isDataRaw {boolean} true means binary 16-bit data, false means float32
 * @returns {SoundFontSample}
 */
function readSample(index, sampleHeaderData, smplArrayData, isDataRaw)
{
    
    // read the sample name
    let sampleName = readBytesAsString(sampleHeaderData, 20);
    
    // read the sample start index
    let sampleStartIndex = readLittleEndian(sampleHeaderData, 4) * 2;
    
    // read the sample end index
    let sampleEndIndex = readLittleEndian(sampleHeaderData, 4) * 2;
    
    // read the sample looping start index
    let sampleLoopStartIndex = readLittleEndian(sampleHeaderData, 4);
    
    // read the sample looping end index
    let sampleLoopEndIndex = readLittleEndian(sampleHeaderData, 4);
    
    // read the sample rate
    let sampleRate = readLittleEndian(sampleHeaderData, 4);
    
    // read the original sample pitch
    let samplePitch = sampleHeaderData[sampleHeaderData.currentIndex++];
    if (samplePitch === 255)
    {
        // if it's 255, then default to 60
        samplePitch = 60;
    }
    
    // read the sample pitch correction
    let samplePitchCorrection = signedInt8(sampleHeaderData[sampleHeaderData.currentIndex++]);
    
    
    // read the link to the other channel
    let sampleLink = readLittleEndian(sampleHeaderData, 2);
    let sampleType = readLittleEndian(sampleHeaderData, 2);
    
    
    return new SoundFontSample(
        sampleName,
        sampleStartIndex,
        sampleEndIndex,
        sampleLoopStartIndex,
        sampleLoopEndIndex,
        sampleRate,
        samplePitch,
        samplePitchCorrection,
        sampleLink,
        sampleType,
        smplArrayData,
        index,
        isDataRaw
    );
}