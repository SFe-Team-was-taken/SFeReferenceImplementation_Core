import { SpessaSynthInfo } from "./loggin.js";
import { consoleColors } from "./other.js";
import { DEFAULT_PERCUSSION } from "../synthetizer/synth_constants.js";

export const XG_SFX_VOICE = 64;

const GM2_DEFAULT_BANK = 121;

/**
 * @param sys {SynthSystem}
 * @returns {number}
 */
export function getDefaultBank(sys)
{
    return sys === "gm2" ? GM2_DEFAULT_BANK : 0;
}

/**
 * @param bankMSB {number}
 * @returns {boolean}
 */
export function isXGDrums(bankMSB)
{
    return bankMSB === 120 || bankMSB === 126 || bankMSB === 127;
}

/**
 * @param bank {number}
 * @returns {boolean}
 */
export function isValidXGMSB(bank)
{
    return isXGDrums(bank) || bank === XG_SFX_VOICE || bank === GM2_DEFAULT_BANK;
}

/**
 * Bank select hacks abstracted here
 * @param bankBefore {number} the current bank number
 * @param bank {number} the cc change bank number
 * @param system {SynthSystem} MIDI system
 * @param isLSB {boolean} is bank LSB?
 * @param isDrums {boolean} is drum channel?
 * @param channelNumber {number} channel number
 * @returns {{
 *     newBank: number,
 *     drumsStatus: 0|1|2
 * }} 0 - unchanged, 1 - OFF, 2 - ON
 */
export function parseBankSelect(bankBefore, bank, system, isLSB, isDrums, channelNumber)
{
    // 64 means SFX in MSB, so it is allowed
    let out = bankBefore;
    let drumsStatus = 0;
    if (isLSB)
    {
        if (isSystemXG(system))
        {
            if (!isValidXGMSB(bank))
            {
                out = bank;
            }
        }
        else if (system === "gm2")
        {
            out = bank;
        }
    }
    else
    {
        let canSetBankSelect = true;
        switch (system)
        {
            case "gm":
                // gm ignores bank select
                SpessaSynthInfo(
                    `%cIgnoring the Bank Select (${bank}), as the synth is in GM mode.`,
                    consoleColors.info
                );
                canSetBankSelect = false;
                break;
            
            case "xg":
                canSetBankSelect = isValidXGMSB(bank);
                // for xg, if msb is 120, 126 or 127, then it's drums
                if (isXGDrums(bank))
                {
                    drumsStatus = 2;
                }
                else
                {
                    // drums shall not be disabled on channel 9
                    if (channelNumber % 16 !== DEFAULT_PERCUSSION)
                    {
                        drumsStatus = 1;
                    }
                }
                break;
            
            case "gm2":
                if (bank === 120)
                {
                    drumsStatus = 2;
                }
                else
                {
                    if (channelNumber % 16 !== DEFAULT_PERCUSSION)
                    {
                        drumsStatus = 1;
                    }
                }
        }
        
        if (isDrums)
        {
            // 128 for percussion channel
            bank = 128;
        }
        if (bank === 128 && !isDrums)
        {
            // if a channel is not for percussion, default to bank current
            bank = bankBefore;
        }
        if (canSetBankSelect)
        {
            out = bank;
        }
    }
    return {
        newBank: out,
        drumsStatus: drumsStatus
    };
}


/**
 * Chooses a bank number according to spessasynth logic
 * That is:
 * for GS, bank MSB if not drum, otherwise 128 + MSB
 * for XG: bank 128 if drums and MSB is invalid, otherwise MSB 
 * @param msb {number}
 * @param lsb {number}
 * @param isDrums {boolean}
 * @param isXG {boolean}
 * @returns {number}
 */
export function chooseBank(msb, lsb, isDrums, isXG)
{
    if (isXG)
    {
        if (isDrums)
        {
            if (isXGDrums(msb))
            {
                return msb;
            }
            else
            {
                return 128;
            }
        }
        else
        {
            return msb;
        }
    }
    else
    {
        return isDrums ? (128 + msb) : msb;
    }
}

/**
 * @param system {SynthSystem}
 * @returns boolean
 */
export function isSystemXG(system)
{
    return system === "gm2" || system === "xg";
}