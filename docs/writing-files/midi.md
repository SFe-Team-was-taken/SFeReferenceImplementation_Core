# Writing MIDI Files

Below is a basic guide to writing .mid and .rmi files.

## Writing a MIDI file

!!! Important

    Also see [Creating MIDI Files From Scratch](../midi/creating-midi-files.md)

### writeMIDI

Renders the sequence as a Standard MIDI File. Note: makes heavy use of the running status.

```ts
midi.writeMIDI();
```

The returned value is an `Uint8Array` - a binary representation of the Standard MIDI File.

### modifyMIDI

Allows easily modifying the sequence's programs and controllers.

```ts
midi.modifyMIDI(desiredProgramChanges, desiredControllerChanges, desiredChannelsToClear, desiredChannelsToTranspose);
```

- desiredProgramChanges - an array of objects, defined as follows:

```ts
/**
 * @typedef desiredProgramChange {Object}
 * @property {number} channel - the channel to modify. Note that this allows going over 16 if the MIDI is a multi port file
 * @property {number} program - the MIDI program to use.
 * @property {number} bank - the bank to use.
 * @property {boolean} isDrum - if the channel is a drum channel. Will add GS Use Drums System exclusive and GS on if needed
 */
```

- desiredControllerChanges - an array of objects, defined as follows:

```ts
/**
 * @typedef desiredControllerChange {Object}
 * @property {number} channel - same as above.
 * @property {number} controllerNumber - the MIDI CC number to use.
 * @property {number} controllerValue - the desired value of the controller.
 *
 */
```

- desiredChannelsToClear - an array of numbers, indicating the channel number to effectively mute.
- desiredChannelsToTranspose - an array of objects, defined as follows:

```ts
/**
 * @typedef desiredTranspose {Object}
 * @property {number} channel - same as above.
 * @property {number} keyShift - the amount to shift the notes on this channel by. Can be negative. The decimal part will be tuned via the RPN fine tune command if provided.
 */
```

!!! Warning

    Clearing the channel removes the messages rather than setting volume to 0! This operation is irreversible if the
    original midi file is lost.

### applySnapshot

Applies a [SynthesizerSnapshot](../spessa-synth-processor/synthesizer-snapshot.md) to the sequence *in place*.
This means changing the programs and controllers if they are locked.

```ts
midi.applySnapshotToMIDI(snapshot);
```

- snapshot - the `SynthesizerSnapshot` to use.

For example, if channel 1 has locked preset on `Drawbar Organ`,
this will remove all program changes for channel 1 and add one at the start to change the program to `Drawbar organ`.

### Example

Below is a basic example of writing a modified MIDI file

```ts
// create your midi and synthesizer
const midi = new MIDI(yourBufferGoesHere);
const synth = new Synthetizer(yourContext, yourSoundfontBuffer);

// ...

// get the snapshot and apply it
const snapshot = await synth.getSynthesizerSnapshot();
mid.applySnapshotToMIDI(snapshot);

// write midi 
const midiBinary = midi.writeMIDI();

// save the file
const blob = new Blob([midiBinary.buffer], {type: "audio/midi"});
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = midi.name + ".mid";
a.click();
```

## Writing an .rmi file

### writeRMIDI

This function writes out an RMIDI file (MIDI + SF2).
[See more info about this format](https://github.com/spessasus/sf2-rmidi-specification#readme)

```ts
const rmidiBinary = midi.writeRMIDI(
    soundfontBinary,
    soundfont,
    bankOffset = 0,
    encoding = "Shift_JIS",
    metadata = {},
    correctBankOffset = true
);
```

### Parameters

#### soundfontBinary

an `Uint8Array` of the soundfont to embed, created by `soundfont.write()`.

#### midi

`MIDI` to embed.

#### soundfont

`SoundFont2` - The soundfont that `soundfontBinary` contains. Used for correcting bank and program changes.

#### bankOffset

`number`, optional - The bank offset to apply to the file. A value of 0 is
recommended. [See this for more info](https://github.com/spessasus/sf2-rmidi-specification#dbnk-chunk)

#### encoding

`string`, optional - The encoding to add to the INFO chunk of an RMID file. Make sure to pick a value that is acceptable
by the `TextDecoder`

#### metadata

`Object`, optional - The metadata of the file. If left undefined, some basic metadata (like song's title) will be copied
from the MIDI.

!!! Important

    All the properties below are *optional*.

- name - `string` - the name of the song.
- engineer - `string` - the engineer of the soundfont.
- artist - `string` - the artist of the song.
- album - `string` - the album's name.
- genre - `string` - the song's genre.
- comment - `string` - a comment about the song.
- creationDate - `string` - the creation date of the file. If not provided, current day is used.
- copyright - `string` - the copyright string. If not provided, `midi.copyright` is copied.
- picture - `ArrayBuffer` - the album cover of the song. Binary data of the image.
- midiEncoding - `string` - The encoding of the inner MIDI file. Make sure to pick a value that is acceptable by the
  `TextDecoder`

!!! Caution

    Providing *any* of the metadata fields overrides the encoding with `utf-8`.
    This behavior is forced due to lack of support for other encodings by the `TextEncoder` class.

#### correctBankOffset

`boolean`, optional - if the function should correct all the
program-selects, and the bank-selects in the MIDI file to reflect the embedded soundfont
(i.e., Make it [Self-contained](https://github.com/spessasus/sf2-rmidi-specification#self-contained-file)).
Recommended unless a specific use-case is required.
Defaults to `true`.

!!! Tip

    use [trimSoundBank](../sound-bank/index.md#trimsoundbank) to drastically reduce the file size.
    consider also using compression (like shown in example) to save even more space.
    (using these both methods, I managed to cram a 1GB soundfont into a 5MB RMIDI!)

### Example

Below is a simple example for exporting an RMIDI file

```html
<label for='soundfont_upload'>Upload soundfont</label>
<input type='file' id='soundfont_upload'>
<label for='midi_upload'>Upload MIDI</label>
<input type='file' id='midi_upload'>
<button id='export'>Export</button>
```

!!! Note

    This example uses soundfont3 compression.
    Make sure you've [read this](../sound-bank/index.md#compressionfunction)

```ts
const sfInput = document.getElementById("soundfont_upload");
const midiInput = document.getElementById("midi_upload");
document.getElementById("export").onchange = async () => {
    // get the files
    const soundfont = loadSoundFont(await sfInput.files[0].arrayBuffer());
    const midi = new MIDI(await midiInput.files[0].arrayBuffer());

    // trim the soundfont
    soundfont.trimSoundBank(soundfont);
    // write out with compression to save space (0.5 is medium quality)
    const soundfontBinary = await soundfont.write({
        compress: true,
        compressionFunction: SampleEncodingFunction // Remember to get your compression function
    });
    // get the rmidi
    const rmidiBinary = midi.writeRMIDI(soundfontBinary, soundfont, 0, 'utf-8', {
        name: "A cool song",
        artist: "John",
        creationDate: new Date().toDateString(),
        album: "John's songs",
        genre: "Rock",
        comment: "My favorite!"
    });

    // save the file
    const blob = new Blob([rmidiBinary.buffer], {type: "audio/rmid"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = midi.name + ".rmi";
    a.click();
}
```
