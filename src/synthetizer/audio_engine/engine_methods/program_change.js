/**
 * executes a program change
 * @param programNumber {number}
 * @this {MidiAudioChannel}
 */
export function programChange(programNumber)
{
    if (this.lockPreset)
    {
        return;
    }
    // Add 128 with percussion
    let bank = this.getBankSelect();
    let isDrums;
    if (bank >= 128)
    {
        isDrums = true;
    } else {
        isDrums = false;
    }
    const isXG = this.isXGChannel;
    const p = this.synth.soundfontManager.getPreset(bank, this.bankLSB, programNumber, isXG); 
    const preset = p.preset;
    this.setPreset(preset);

    if (isDrums)
    {
        this.sentBank = Math.min(127, preset.bank + p.bankOffset);
    } else {
        this.sentBank = Math.min(255, preset.bank + p.bankOffset);
    }

    this.synth.callEvent("programchange", {
        channel: this.channelNumber,
        program: preset.program,
        bank: this.sentBank,
        bankLSB: this.bankLSB
    });
    this.sendChannelProperty();
}