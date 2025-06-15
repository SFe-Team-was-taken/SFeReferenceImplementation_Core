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
    // always 128 for percussion
    let bank = this.getBankSelect();
    
    const isXG = this.isXGChannel;
    const p = this.synth.soundfontManager.getPreset(bank, 0, programNumber, isXG); 
    // LSB forced to zero above.
    // This will be fixed once XG hacks are reimplemented.
    const preset = p.preset;
    this.setPreset(preset);
    this.sentBank = Math.min(128, preset.bank + p.bankOffset);
    this.synth.callEvent("programchange", {
        channel: this.channelNumber,
        program: preset.program,
        bank: this.sentBank
    });
    this.sendChannelProperty();
}