import { SpessaSynthInfo } from "../../utils/loggin.js";
import { consoleColors } from "../../utils/other.js";
import { voiceKilling } from "./engine_methods/stopping_notes/voice_killing.js";
import { ALL_CHANNELS_OR_DIFFERENT_ACTION, DEFAULT_SYNTH_MODE, VOICE_CAP } from "../synth_constants.js";
import { stbvorbis } from "../../externals/stbvorbis_sync/stbvorbis_sync.min.js";
import { VOLUME_ENVELOPE_SMOOTHING_FACTOR } from "./engine_components/volume_envelope.js";
import { systemExclusive } from "./engine_methods/system_exclusive.js";
import { masterParameterType, setMasterParameter } from "./engine_methods/controller_control/master_parameters.js";
import { resetAllControllers } from "./engine_methods/controller_control/reset_controllers.js";
import { SoundFontManager } from "./engine_components/soundfont_manager.js";
import { KeyModifierManager } from "./engine_components/key_modifier_manager.js";
import { getVoices, getVoicesForPreset } from "./engine_components/voice.js";
import { PAN_SMOOTHING_FACTOR } from "./engine_components/stereo_panner.js";
import { stopAllChannels } from "./engine_methods/stopping_notes/stop_all_channels.js";
import { clearEmbeddedBank, setEmbeddedSoundFont } from "./engine_methods/soundfont_management/embedded_sound_bank.js";
import { updatePresetList } from "./engine_methods/soundfont_management/update_preset_list.js";
import { transposeAllChannels } from "./engine_methods/tuning_control/transpose_all_channels.js";
import { setMasterTuning } from "./engine_methods/tuning_control/set_master_tuning.js";
import { applySynthesizerSnapshot } from "./snapshot/apply_synthesizer_snapshot.js";
import { createMidiChannel } from "./engine_methods/create_midi_channel.js";
import { FILTER_SMOOTHING_FACTOR } from "./engine_components/lowpass_filter.js";
import { getEvent, messageTypes } from "../../midi/midi_message.js";
import { IndexedByteArray } from "../../utils/indexed_array.js";
import { interpolationTypes } from "./engine_components/enums.js";
import { DEFAULT_SYNTH_OPTIONS } from "./synth_processor_options.js";
import { fillWithDefaults } from "../../utils/fill_with_defaults.js";
import { isSystemXG } from "../../utils/xg_hacks.js";


/**
 * @typedef {"gm"|"gm2"|"gs"|"xg"} SynthSystem
 */

/**
 * main_processor.js
 * purpose: the core synthesis engine
 */


/**
 * @typedef {Object} NoteOnCallback
 * @property {number} midiNote - The MIDI note number.
 * @property {number} channel - The MIDI channel number.
 * @property {number} velocity - The velocity of the note.
 */

/**
 * @typedef {Object} NoteOffCallback
 * @property {number} midiNote - The MIDI note number.
 * @property {number} channel - The MIDI channel number.
 */

/**
 * @typedef {Object} DrumChangeCallback
 * @property {number} channel - The MIDI channel number.
 * @property {boolean} isDrumChannel - Indicates if the channel is a drum channel.
 */

/**
 * @typedef {Object} ProgramChangeCallback
 * @property {number} channel - The MIDI channel number.
 * @property {number} program - The program number.
 * @property {number} bank - The bank number (MSB).
 * @property {number} bankLSB - The bank number (LSB).
 */

/**
 * @typedef {Object} ControllerChangeCallback
 * @property {number} channel - The MIDI channel number.
 * @property {number} controllerNumber - The controller number.
 * @property {number} controllerValue - The value of the controller.
 */

/**
 * @typedef {Object} MuteChannelCallback
 * @property {number} channel - The MIDI channel number.
 * @property {boolean} isMuted - Indicates if the channel is muted.
 */

/**
 * @typedef {Object} PresetListChangeCallbackSingle
 * @property {string} presetName - The name of the preset.
 * @property {number} bank - The bank number.
 * @property {number} program - The program number.
 */

/**
 * @typedef {PresetListChangeCallbackSingle[]} PresetListChangeCallback - A list of preset objects.
 */

/**
 * @typedef {Object} SynthDisplayCallback
 * @property {Uint8Array} displayData - The data to display.
 * @property {synthDisplayTypes} displayType - The type of display.
 */

/**
 * @typedef {Object} PitchWheelCallback
 * @property {number} channel - The MIDI channel number.
 * @property {number} MSB - The most significant byte of the pitch-wheel value.
 * @property {number} LSB - The least significant byte of the pitch-wheel value.
 */

/**
 * @typedef {Object} ChannelPressureCallback
 * @property {number} channel - The MIDI channel number.
 * @property {number} pressure - The pressure value.
 */

/**
 * @typedef {Error} SoundfontErrorCallback - The error message for soundfont errors.
 */

/**
 * @typedef {
 *     NoteOnCallback |
 *     NoteOffCallback |
 *     DrumChangeCallback |
 *     ProgramChangeCallback |
 *     ControllerChangeCallback |
 *     MuteChannelCallback |
 *     PresetListChangeCallback |
 *     PitchWheelCallback |
 *     SoundfontErrorCallback |
 *     ChannelPressureCallback |
 *     SynthDisplayCallback |
 *     undefined
 * } EventCallbackData
 */

/**
 * @typedef {
 * "noteon"|
 * "noteoff"|
 * "pitchwheel"|
 * "controllerchange"|
 * "programchange"|
 * "channelpressure"|
 * "polypressure" |
 * "drumchange"|
 * "stopall"|
 * "newchannel"|
 * "mutechannel"|
 * "presetlistchange"|
 * "allcontrollerreset"|
 * "soundfonterror"|
 * "synthdisplay"} EventTypes
 */


/**
 * @typedef {Object} SynthMethodOptions
 * @property {number} time - the audio context time when the event should execute, in seconds.
 */

/**
 * @type {SynthMethodOptions}
 */
const DEFAULT_SYNTH_METHOD_OPTIONS = {
    time: 0
};

// if the note is released faster than that, it forced to last that long
// this is used mostly for drum channels, where a lot of midis like to send instant note off after a note on
export const MIN_NOTE_LENGTH = 0.03;
// this sounds way nicer for an instant hi-hat cutoff
export const MIN_EXCLUSIVE_LENGTH = 0.07;

export const SYNTHESIZER_GAIN = 1.0;


// the core synthesis engine of spessasynth.
class SpessaSynthProcessor
{
    
    /**
     * Cached voices for all presets for this synthesizer.
     * Nesting goes like this:
     * this.cachedVoices[bankNumberMSB][bankNumberLSB][programNumber][midiNote][velocity] = a list of voices for that.
     * @type {Voice[][][][][][]}
     */
    cachedVoices = [];
    
    /**
     * Synth's device id: -1 means all
     * @type {number}
     */
    deviceID = ALL_CHANNELS_OR_DIFFERENT_ACTION;
    
    /**
     * Synth's event queue from the main thread
     * @type {{callback: function(), time: number}[]}
     */
    eventQueue = [];
    
    /**
     * Interpolation type used
     * @type {interpolationTypes}
     */
    interpolationType = interpolationTypes.fourthOrder;
    
    /**
     * Global transposition in semitones
     * @type {number}
     */
    transposition = 0;
    
    /**
     * this.tunings[program][key] = tuning
     * @type {MTSProgramTuning[]}
     */
    tunings = [];
    
    
    /**
     * Bank offset for things like embedded RMIDIS. Added for every program change
     * @type {number}
     */
    soundfontBankOffset = 0;
    
    /**
     * The volume gain, set by user
     * @type {number}
     */
    masterGain = SYNTHESIZER_GAIN;
    
    /**
     * The volume gain, set by MIDI sysEx
     * @type {number}
     */
    midiVolume = 1;
    
    /**
     * Reverb linear gain
     * @type {number}
     */
    reverbGain = 1;
    /**
     * Chorus linear gain
     * @type {number}
     */
    chorusGain = 1;
    
    /**
     * Set via system exclusive
     * @type {number}
     */
    reverbSend = 1;
    /**
     * Set via system exclusive
     * @type {number}
     */
    chorusSend = 1;
    
    /**
     * Maximum number of voices allowed at once
     * @type {number}
     */
    voiceCap = VOICE_CAP;
    
    /**
     * (-1 to 1)
     * @type {number}
     */
    pan = 0.0;
    /**
     * the pan of the left channel
     * @type {number}
     */
    panLeft = 0.5;
    
    /**
     * the pan of the right channel
     * @type {number}
     */
    panRight = 0.5;
    
    /**
     * forces note killing instead of releasing
     * @type {boolean}
     */
    highPerformanceMode = false;
    
    /**
     * Handlese custom key overrides: velocity and preset
     * @type {KeyModifierManager}
     */
    keyModifierManager = new KeyModifierManager();
    
    /**
     * contains all the channels with their voices on the processor size
     * @type {MidiAudioChannel[]}
     */
    midiAudioChannels = [];
    
    /**
     * Controls the bank selection & SysEx
     * @type {SynthSystem}
     */
    system = DEFAULT_SYNTH_MODE;
    /**
     * Current total voices amount
     * @type {number}
     */
    totalVoicesAmount = 0;
    
    /**
     * Synth's default (reset) preset
     * @type {BasicPreset}
     */
    defaultPreset;
    
    /**
     * Synth's default (reset) drum preset
     * @type {BasicPreset}
     */
    drumPreset;
    
    /**
     * Controls if the processor is fully initialized
     * @type {Promise<boolean>}
     */
    processorInitialized = stbvorbis.isInitialized;
    
    /**
     * Current audio time
     * @type {number}
     */
    currentSynthTime = 0;
    
    /**
     * in hertz
     * @type {number}
     */
    sampleRate;
    
    /**
     * Sample time in seconds
     * @type {number}
     */
    sampleTime;
    
    /**
     * are the chorus and reverb effects enabled?
     * @type {boolean}
     */
    effectsEnabled;
    
    /**
     * for applying the snapshot after an override sound bank too
     * @type {SynthesizerSnapshot}
     * @private
     */
    _snapshot;
    
    /**
     * Calls when an event occurs.
     * @type {function}
     * @param {EventTypes} eventType - the event type.
     * @param {EventCallbackData} eventData - the event data.
     */
    onEventCall;
    
    /**
     * Calls when a channel property is changed.
     * @type {function}
     * @param {ChannelProperty} property - the updated property.
     * @param {number} channelNumber - the channel number of the said property.
     */
    onChannelPropertyChange;
    
    /**
     * Calls when a master parameter is changed.
     * @type {function}
     * @param {masterParameterType} parameter - the parameter type
     * @param {number|string} value - the new value.
     */
    onMasterParameterChange;
    
    
    /**
     * Creates a new synthesizer engine.
     * @param sampleRate {number} - sample rate, in Hertz.
     * @param options {SynthProcessorOptions} - the processor's options.
     */
    constructor(sampleRate,
                options = DEFAULT_SYNTH_OPTIONS)
    {
        options = fillWithDefaults(options, DEFAULT_SYNTH_OPTIONS);
        /**
         * Midi output count
         * @type {number}
         */
        this.midiOutputsCount = options.midiChannels;
        this.effectsEnabled = options.effectsEnabled;
        this.enableEventSystem = options.enableEventSystem;
        this.currentSynthTime = options.initialTime;
        this.sampleTime = 1 / sampleRate;
        this.sampleRate = sampleRate;
        
        // these smoothing factors were tested on 44,100 Hz, adjust them to target sample rate here
        this.volumeEnvelopeSmoothingFactor = VOLUME_ENVELOPE_SMOOTHING_FACTOR * (44100 / sampleRate);
        this.panSmoothingFactor = PAN_SMOOTHING_FACTOR * (44100 / sampleRate);
        this.filterSmoothingFactor = FILTER_SMOOTHING_FACTOR * (44100 / sampleRate);
        
        
        for (let i = 0; i < 128; i++)
        {
            this.tunings.push([]);
        }
        
        /**
         * @type {SoundFontManager}
         */
        this.soundfontManager = new SoundFontManager(this.updatePresetList.bind(this));
        
        for (let i = 0; i < this.midiOutputsCount; i++)
        {
            this.createMidiChannel(false);
        }
        this.processorInitialized.then(() =>
        {
            SpessaSynthInfo("%cSpessaSynth is ready!", consoleColors.recognized);
        });
    }
    
    /**
     * @returns {number}
     */
    get currentGain()
    {
        return this.masterGain * this.midiVolume;
    }
    
    getDefaultPresets()
    {
        // override this to XG, to set the default preset to NOT be XG drums!
        const sys = this.system;
        this.system = "xg";
        this.defaultPreset = this.getPreset(0, 0, 0);
        this.system = sys;
        this.drumPreset = this.getPreset(128, 0, 0);
    }
    
    /**
     * @param value {SynthSystem}
     */
    setSystem(value)
    {
        this.system = value;
        this?.onMasterParameterChange?.(masterParameterType.midiSystem, this.system);
    }
    
    /**
     * @param bank {number}
     * @param program {number}
     * @param midiNote {number}
     * @param velocity {number}
     * @returns {Voice[]|undefined}
     */
    getCachedVoice(bank, bankLSB, program, midiNote, velocity)
    {
        return this.cachedVoices?.[bank]?.[bankLSB]?.[program]?.[midiNote]?.[velocity];
    }
    
    /**
     * @param bank {number}
     * @param bankLSB {number}
     * @param program {number}
     * @param midiNote {number}
     * @param velocity {number}
     * @param voices {Voice[]}
     */
    setCachedVoice(bank, bankLSB, program, midiNote, velocity, voices)
    {
        // make sure that it exists
        if (!this.cachedVoices[bank])
        {
            this.cachedVoices[bank] = [];
        }
        if (!this.cachedVoices[bank][bankLSB])
        {
            this.cachedVoices[bank][bankLSB] = [];
        }
        if (!this.cachedVoices[bank][bankLSB][program])
        {
            this.cachedVoices[bank][bankLSB][program] = [];
        }
        if (!this.cachedVoices[bank][bankLSB][program][midiNote])
        {
            this.cachedVoices[bank][bankLSB][program][midiNote] = [];
        }
        
        // cache
        this.cachedVoices[bank][bankLSB][program][midiNote][velocity] = voices;
    }
    
    // noinspection JSUnusedGlobalSymbols
    /**
     * Renders float32 audio data to stereo outputs; buffer size of 128 is recommended
     * All float arrays must have the same length
     * @param outputs {Float32Array[]} output stereo channels (L, R)
     * @param reverb {Float32Array[]} reverb stereo channels (L, R)
     * @param chorus {Float32Array[]} chorus stereo channels (L, R)
     */
    renderAudio(outputs, reverb, chorus)
    {
        this.renderAudioSplit(reverb, chorus, Array(16).fill(outputs));
    }
    
    /**
     * Renders the float32 audio data of each channel; buffer size of 128 is recommended
     * All float arrays must have the same length
     * @param reverbChannels {Float32Array[]} reverb stereo channels (L, R)
     * @param chorusChannels {Float32Array[]} chorus stereo channels (L, R)
     * @param separateChannels {Float32Array[][]} a total of 16 stereo pairs (L, R) for each MIDI channel
     */
    renderAudioSplit(reverbChannels, chorusChannels, separateChannels)
    {
        // process event queue
        const time = this.currentSynthTime;
        while (this.eventQueue[0]?.time <= time)
        {
            this.eventQueue.shift().callback();
        }
        const revL = reverbChannels[0];
        const revR = reverbChannels[1];
        const chrL = chorusChannels[0];
        const chrR = chorusChannels[1];
        
        // for every channel
        this.totalVoicesAmount = 0;
        this.midiAudioChannels.forEach((channel, index) =>
        {
            if (channel.voices.length < 1 || channel.isMuted)
            {
                // there's nothing to do!
                return;
            }
            let voiceCount = channel.voices.length;
            const ch = index % 16;
            
            // render to the appropriate output
            channel.renderAudio(
                separateChannels[ch][0], separateChannels[ch][1],
                revL, revR,
                chrL, chrR
            );
            
            this.totalVoicesAmount += channel.voices.length;
            // if voice count changed, update voice amount
            if (channel.voices.length !== voiceCount)
            {
                channel.sendChannelProperty();
            }
        });
        
        // advance the time appropriately
        this.currentSynthTime += separateChannels[0][0].length * this.sampleTime;
    }
    
    // noinspection JSUnusedGlobalSymbols
    destroySynthProcessor()
    {
        this.midiAudioChannels.forEach(c =>
        {
            delete c.midiControllers;
            delete c.voices;
            delete c.sustainedVoices;
            delete c.lockedControllers;
            delete c.preset;
            delete c.customControllers;
        });
        delete this.cachedVoices;
        delete this.midiAudioChannels;
        this.soundfontManager.destroyManager();
        delete this.soundfontManager;
    }
    
    /**
     * @param channel {number}
     * @param controllerNumber {number}
     * @param controllerValue {number}
     * @param force {boolean}
     */
    controllerChange(channel, controllerNumber, controllerValue, force = false)
    {
        this.midiAudioChannels[channel].controllerChange(controllerNumber, controllerValue, force);
    }
    
    /**
     * @param channel {number}
     * @param midiNote {number}
     * @param velocity {number}
     */
    noteOn(channel, midiNote, velocity)
    {
        this.midiAudioChannels[channel].noteOn(midiNote, velocity);
    }
    
    /**
     * @param channel {number}
     * @param midiNote {number}
     */
    noteOff(channel, midiNote)
    {
        this.midiAudioChannels[channel].noteOff(midiNote);
    }
    
    /**
     * @param channel {number}
     * @param midiNote {number}
     * @param pressure {number}
     */
    polyPressure(channel, midiNote, pressure)
    {
        this.midiAudioChannels[channel].polyPressure(midiNote, pressure);
    }
    
    /**
     * @param channel {number}
     * @param pressure {number}
     */
    channelPressure(channel, pressure)
    {
        this.midiAudioChannels[channel].channelPressure(pressure);
    }
    
    /**
     * @param channel {number}
     * @param MSB {number}
     * @param LSB {number}
     */
    pitchWheel(channel, MSB, LSB)
    {
        this.midiAudioChannels[channel].pitchWheel(MSB, LSB);
    }
    
    /**
     * @param channel {number}
     * @param programNumber {number}
     */
    programChange(channel, programNumber)
    {
        this.midiAudioChannels[channel].programChange(programNumber);
    }
    
    // noinspection JSUnusedGlobalSymbols
    /**
     * Processes a MIDI message
     * @param message {Uint8Array} - the message to process
     * @param channelOffset {number} - channel offset for the message
     * @param force {boolean} cool stuff
     * @param options {SynthMethodOptions} - additional options for scheduling the message
     */
    processMessage(message, channelOffset = 0, force = false, options = DEFAULT_SYNTH_METHOD_OPTIONS)
    {
        const call = () =>
        {
            const statusByteData = getEvent(message[0]);
            
            const channel = statusByteData.channel + channelOffset;
            // process the event
            switch (statusByteData.status)
            {
                case messageTypes.noteOn:
                    const velocity = message[2];
                    if (velocity > 0)
                    {
                        this.noteOn(channel, message[1], velocity);
                    }
                    else
                    {
                        this.noteOff(channel, message[1]);
                    }
                    break;
                
                case messageTypes.noteOff:
                    if (force)
                    {
                        this.midiAudioChannels[channel].killNote(message[1]);
                    }
                    else
                    {
                        this.noteOff(channel, message[1]);
                    }
                    break;
                
                case messageTypes.pitchBend:
                    this.pitchWheel(channel, message[2], message[1]);
                    break;
                
                case messageTypes.controllerChange:
                    this.controllerChange(channel, message[1], message[2], force);
                    break;
                
                case messageTypes.programChange:
                    this.programChange(channel, message[1]);
                    break;
                
                case messageTypes.polyPressure:
                    this.polyPressure(channel, message[0], message[1]);
                    break;
                
                case messageTypes.channelPressure:
                    this.channelPressure(channel, message[1]);
                    break;
                
                case messageTypes.systemExclusive:
                    this.systemExclusive(new IndexedByteArray(message.slice(1)), channelOffset);
                    break;
                
                case messageTypes.reset:
                    this.stopAllChannels(true);
                    this.resetAllControllers();
                    break;
                
                default:
                    break;
            }
        };
        
        const time = options.time;
        if (time > this.currentSynthTime)
        {
            this.eventQueue.push({
                callback: call.bind(this),
                time: time
            });
            this.eventQueue.sort((e1, e2) => e1.time - e2.time);
        }
        else
        {
            call();
        }
    }
    
    /**
     * @param volume {number} 0 to 1
     */
    setMIDIVolume(volume)
    {
        // GM2 specification, section 4.1: volume is squared.
        // though, according to my own testing, Math.E seems like a better choice
        this.midiVolume = Math.pow(volume, Math.E);
        this.setMasterParameter(masterParameterType.masterPan, this.pan);
    }
    
    /**
     * Calls synth event
     * @param eventName {EventTypes} the event name
     * @param eventData {EventCallbackData}
     * @this {SpessaSynthProcessor}
     */
    callEvent(eventName, eventData)
    {
        this?.onEventCall?.(eventName, eventData);
    }
    
    clearCache()
    {
        this.cachedVoices = [];
    }
    
    /**
     * @param program {number}
     * @param bankMSB {number}
     * @param bankLSB {number}
     * @returns {BasicPreset}
     */
    getPreset(bankMSB, bankLSB, program)
    {
        return this.soundfontManager.getPreset(bankMSB, bankLSB, program, isSystemXG(this.system)).preset;
    }
}

// include other methods
// voice related
SpessaSynthProcessor.prototype.voiceKilling = voiceKilling;
SpessaSynthProcessor.prototype.getVoicesForPreset = getVoicesForPreset;
SpessaSynthProcessor.prototype.getVoices = getVoices;

// system-exclusive related
SpessaSynthProcessor.prototype.systemExclusive = systemExclusive;

// channel related
SpessaSynthProcessor.prototype.stopAllChannels = stopAllChannels;
SpessaSynthProcessor.prototype.createMidiChannel = createMidiChannel;
SpessaSynthProcessor.prototype.resetAllControllers = resetAllControllers;

// master parameter related
SpessaSynthProcessor.prototype.setMasterParameter = setMasterParameter;

// tuning related
SpessaSynthProcessor.prototype.transposeAllChannels = transposeAllChannels;
SpessaSynthProcessor.prototype.setMasterTuning = setMasterTuning;

// program related
SpessaSynthProcessor.prototype.clearEmbeddedBank = clearEmbeddedBank;
SpessaSynthProcessor.prototype.setEmbeddedSoundFont = setEmbeddedSoundFont;
SpessaSynthProcessor.prototype.updatePresetList = updatePresetList;

// snapshot related
SpessaSynthProcessor.prototype.applySynthesizerSnapshot = applySynthesizerSnapshot;

export { SpessaSynthProcessor };