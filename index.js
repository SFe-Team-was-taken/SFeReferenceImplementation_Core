// noinspection JSUnusedGlobalSymbols

import { SpessaSynthProcessor } from "./src/synthetizer/audio_engine/main_processor.js";
import { SpessaSynthSequencer } from "./src/sequencer/sequencer_engine.js";
import {
    ALL_CHANNELS_OR_DIFFERENT_ACTION,
    DEFAULT_PERCUSSION,
    DEFAULT_SYNTH_MODE,
    MIDI_CHANNEL_COUNT,
    VOICE_CAP
} from "./src/synthetizer/synth_constants.js";
import {
    channelConfiguration,
    NON_CC_INDEX_OFFSET
} from "./src/synthetizer/audio_engine/engine_components/controller_tables.js";
import { KeyModifier } from "./src/synthetizer/audio_engine/engine_components/key_modifier_manager.js";
import {
    masterParameterType
} from "./src/synthetizer/audio_engine/engine_methods/controller_control/master_parameters.js";
import { SynthesizerSnapshot } from "./src/synthetizer/audio_engine/snapshot/synthesizer_snapshot.js";
import { ChannelSnapshot } from "./src/synthetizer/audio_engine/snapshot/channel_snapshot.js";

import { BasicSoundBank } from "./src/soundfont/basic_soundfont/basic_soundbank.js";
import { BasicSample, CreatedSample, sampleTypes } from "./src/soundfont/basic_soundfont/basic_sample.js";
import { BasicPresetZone } from "./src/soundfont/basic_soundfont/basic_preset_zone.js";
import { BasicInstrument } from "./src/soundfont/basic_soundfont/basic_instrument.js";
import { BasicPreset } from "./src/soundfont/basic_soundfont/basic_preset.js";
import { Generator } from "./src/soundfont/basic_soundfont/generator.js";
import { Modulator, modulatorCurveTypes, modulatorSources } from "./src/soundfont/basic_soundfont/modulator.js";
import { BasicZone } from "./src/soundfont/basic_soundfont/basic_zone.js";
import { BasicGlobalZone } from "./src/soundfont/basic_soundfont/basic_global_zone.js";
import { loadSoundFont } from "./src/soundfont/load_soundfont.js";

import { MIDI } from "./src/midi/midi_loader.js";
import { BasicMIDI } from "./src/midi/basic_midi.js";
import { MIDISequenceData } from "./src/midi/midi_sequence.js";
import { MIDIBuilder } from "./src/midi/midi_builder.js";
import { messageTypes, midiControllers, MIDIMessage } from "./src/midi/midi_message.js";
import { interpolationTypes, synthDisplayTypes } from "./src/synthetizer/audio_engine/engine_components/enums.js";
import { RMIDINFOChunks } from "./src/midi/midi_tools/rmidi_writer.js";
import { IndexedByteArray } from "./src/utils/indexed_array.js";
import { audioToWav } from "./src/utils/buffer_to_wav.js";
import {
    SpessaSynthGroupCollapsed,
    SpessaSynthGroupEnd,
    SpessaSynthInfo,
    SpessaSynthLogging,
    SpessaSynthWarn
} from "./src/utils/loggin.js";
import { readBytesAsUintBigEndian } from "./src/utils/byte_functions/big_endian.js";
import { readLittleEndian } from "./src/utils/byte_functions/little_endian.js";
import { readBytesAsString } from "./src/utils/byte_functions/string.js";
import { readVariableLengthQuantity } from "./src/utils/byte_functions/variable_length_quantity.js";
import { consoleColors } from "./src/utils/other.js";
import { inflateSync } from "./src/externals/fflate/fflate.min.js";
import { DLSDestinations } from "./src/soundfont/dls/dls_destinations.js";
import { DLSSources } from "./src/soundfont/dls/dls_sources.js";
import { generatorTypes } from "./src/soundfont/basic_soundfont/generator_types.js";
import { BasicInstrumentZone } from "./src/soundfont/basic_soundfont/basic_instrument_zone.js";
// you shouldn't use these...
const SpessaSynthCoreUtils = {
    consoleColors,
    SpessaSynthInfo,
    SpessaSynthWarn,
    SpessaSynthGroupCollapsed,
    SpessaSynthGroupEnd,
    readBytesAsUintBigEndian,
    readLittleEndian,
    readBytesAsString,
    readVariableLengthQuantity,
    inflateSync
};

// see All-NPN-Exports.md in the wiki
export {
    // synth and seq
    SpessaSynthSequencer,
    SpessaSynthProcessor,
    SynthesizerSnapshot,
    ChannelSnapshot,
    KeyModifier,
    
    masterParameterType,
    channelConfiguration,
    interpolationTypes,
    synthDisplayTypes,
    DEFAULT_PERCUSSION,
    VOICE_CAP,
    ALL_CHANNELS_OR_DIFFERENT_ACTION,
    NON_CC_INDEX_OFFSET,
    DEFAULT_SYNTH_MODE,
    MIDI_CHANNEL_COUNT,
    
    // sound banks
    loadSoundFont,
    Generator,
    Modulator,
    BasicZone,
    BasicGlobalZone,
    BasicSample,
    CreatedSample,
    BasicInstrumentZone,
    BasicInstrument,
    BasicPreset,
    BasicPresetZone,
    BasicSoundBank,
    
    modulatorSources,
    modulatorCurveTypes,
    generatorTypes,
    DLSSources,
    DLSDestinations,
    sampleTypes,
    
    
    // MIDI
    MIDI,
    MIDISequenceData,
    BasicMIDI,
    MIDIBuilder,
    MIDIMessage,
    
    RMIDINFOChunks,
    midiControllers,
    messageTypes,
    
    // utils
    IndexedByteArray,
    audioToWav,
    SpessaSynthLogging,
    SpessaSynthCoreUtils
};