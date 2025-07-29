import type { SynthMethodOptions, SynthSystem } from "../../types";

/**
 * Synthesizer's default voice cap.
 */
export const VOICE_CAP = 350;
/**
 * Default MIDI drum channel.
 */
export const DEFAULT_PERCUSSION = 9;
/**
 * MIDI channel count.
 */
export const MIDI_CHANNEL_COUNT = 16;
/**
 * Default bank select and SysEx mode.
 */
export const DEFAULT_SYNTH_MODE: SynthSystem = "gs";

export const ALL_CHANNELS_OR_DIFFERENT_ACTION = -1;

// used globally to identify the embedded sound bank
// this is used to prevent the embedded bank from being deleted.
export const EMBEDDED_SOUND_BANK_ID = `SPESSASYNTH_EMBEDDED_BANK_${Math.random()}`;

export const GENERATOR_OVERRIDE_NO_CHANGE_VALUE = 32767;
/**
 * main_processor.js
 * purpose: the core synthesis engine
 */

export const DEFAULT_SYNTH_METHOD_OPTIONS: SynthMethodOptions = {
    time: 0
};
// if the note is released faster than that, it forced to last that long
// this is used mostly for drum channels, where a lot of midis like to send instant note off after a note on
export const MIN_NOTE_LENGTH = 0.03;
// this sounds way nicer for an instant hi-hat cutoff
export const MIN_EXCLUSIVE_LENGTH = 0.07;
export const SYNTHESIZER_GAIN = 1.0;
