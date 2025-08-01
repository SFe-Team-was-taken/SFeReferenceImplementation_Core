import { IndexedByteArray } from "../indexed_array.js";

/**
 * @param dataArray {IndexedByteArray}
 * @param bytes {number}
 * @param trimEnd {boolean} if we should trim once we reach an invalid byte
 * @returns {string}
 */
export function readBytesAsString(dataArray, bytes, trimEnd = true)
{
    let finished = false;
    let string = "";
    for (let i = 0; i < bytes; i++)
    {
        let byte = dataArray[dataArray.currentIndex++];
        if (finished)
        {
            continue;
        }
        if ((byte < 32 || byte > 127) && byte !== 10) // 10 is "\n"
        {
            if (trimEnd)
            {
                finished = true;
                continue;
            }
            else
            {
                if (byte === 0)
                {
                    finished = true;
                    continue;
                }
            }
        }
        string += String.fromCharCode(byte);
    }
    return string;
}

/**
 * @param string {string}
 * @param addZero {boolean} adds a zero terminator at the end
 * @param ensureEven {boolean} ensures even byte count
 * @returns {IndexedByteArray}
 */
export function getStringBytes(string, addZero = false, ensureEven = false)
{
    let len = string.length;
    if (addZero)
    {
        len++;
    }
    if (ensureEven && len % 2 !== 0)
    {
        len++;
    }
    const arr = new IndexedByteArray(len);
    writeStringAsBytes(arr, string);
    return arr;
}

/**
 * This function decodes a UTF-8 string without using TextDecoder. This is done because AudioWorkletGlobalScope does not support the TextDecoder.
 * @param utf8Array {IndexedByteArray}
 * @returns {string}
 */
export function decodeUtf8(utf8Array)
{
    let decoded;
    let dataArray = new IndexedByteArray(utf8Array.length);
    let utf8Char = new Uint8Array(4);
    let decodedChar;
    let decodedLength = 0;
    let error = 0;
    let secondChar;

    dataArray.set(utf8Array, 0);

    while (dataArray.length > dataArray.currentIndex)
    {
        error = 0;
        if (dataArray[dataArray.currentIndex] != 0)
        {
            utf8Char[0] = dataArray[dataArray.currentIndex++];
            if (utf8Char[0] < 128) // ascii character bytes
            {
                decodedChar = String.fromCodePoint(utf8Char[0]);
            } 
            else if (utf8Char[0] < 194) // continuation and invalid bytes
            {
                decodedChar = String.fromCodePoint(65533); // 65533 = U+FFFD, the Unicode replacement character
            }
            else if (utf8Char[0] < 224) // two byte code points
            {
                utf8Char[1] = dataArray[dataArray.currentIndex++];
                if (utf8Char[1] < 128) // invalid bytes
                {
                    error = 1;
                    decodedChar = String.fromCodePoint(65533);
                    secondChar = utf8Char[1];
                }
                else if (utf8Char[1] < 192) // continuation bytes
                {
                    let decodedPoint = (utf8Char[1] & 15) + (utf8Char[1] & 48) + ((utf8Char[0] & 3) << 6) + ((utf8Char[0] & 28) << 6);
                    decodedChar = String.fromCodePoint(decodedPoint);
                }
                else // invalid bytes
                {
                    decodedChar = String.fromCodePoint(65533);                
                }
            }
            else if (utf8Char[0] < 240) // three byte code points
            {
                utf8Char[1] = dataArray[dataArray.currentIndex++];
                if (utf8Char[1] < 128) // invalid bytes
                {
                    error = 1;
                    decodedChar = String.fromCodePoint(65533);
                    secondChar = utf8Char[1];
                }
                else if (utf8Char[1] < 160 && utf8Char[0] == 224) // overlong encoding bytes
                {
                    decodedChar = String.fromCodePoint(65533);
                }
                else if (utf8Char[1] < 192) // continuation bytes
                {
                    utf8Char[2] = dataArray[dataArray.currentIndex++];
                    if (utf8Char[2] < 128) // invalid bytes
                    {
                        error = 1;
                        decodedChar = String.fromCodePoint(65533);
                        secondChar = utf8Char[2];
                    }
                    else if (utf8Char[2] < 192) // continuation bytes
                    {
                        let decodedPoint = (utf8Char[2] & 15) + (utf8Char[2] & 48) + ((utf8Char[1] & 3) << 6) + ((utf8Char[1] & 60) << 6) + ((utf8Char[0] & 15) << 12);
                        if (decodedChar >= 55296 && decodedChar <= 57343) // UTF-16 surrogates are invalid
                        {
                            decodedPoint = 65533;
                        }
                        decodedChar = String.fromCodePoint(decodedPoint);
                    }
                    else // invalid bytes
                    {
                        decodedChar = String.fromCodePoint(65533);
                    }
                }
                else // invalid bytes
                {
                    decodedChar = String.fromCodePoint(65533);               
                }
            }
            else if (utf8Char[0] < 245) // four byte code points
            {
                utf8Char[1] = dataArray[dataArray.currentIndex++];
                if (utf8Char[1] < 128) // invalid bytes
                {
                    error = 1;
                    decodedChar = String.fromCodePoint(65533);
                    secondChar = utf8Char[1];
                }
                else if (utf8Char[1] < 144 && utf8Char[0] == 240) // overlong encoding bytes
                {
                    decodedChar = String.fromCodePoint(65533);
                }
                else if (utf8Char[1] < 192) // continuation bytes
                {
                    utf8Char[2] = dataArray[dataArray.currentIndex++];
                    if (utf8Char[2] < 128) // invalid bytes
                    {
                        error = 1;
                        decodedChar = String.fromCodePoint(65533);
                        secondChar = utf8Char[2];
                    }
                    else if (utf8Char[2] < 192) // continuation bytes
                    {
                        utf8Char[3] = dataArray[dataArray.currentIndex++];
                        if (utf8Char[3] < 128) // invalid bytes
                        {
                            error = 1;
                            decodedChar = String.fromCodePoint(65533);
                            secondChar = utf8Char[3];
                        }
                        else if (utf8Char[3] < 192) // continuation bytes
                        {
                            if (utf8Char[0] == 244) // out of range
                            {
                                decodedChar = String.fromCodePoint(65533);
                            }
                            else 
                            {
                                let decodedPoint = (utf8Char[3] & 15) + (utf8Char[3] & 48)+ ((utf8Char[2] & 3) << 6) + ((utf8Char[2] & 60) << 6) + ((utf8Char[1] & 15) << 12) + ((utf8Char[1] & 48) << 12) + ((utf8Char[0] & 3) << 18) + ((utf8Char[0] & 4) << 18);
                                decodedChar = String.fromCodePoint(decodedPoint);
                            }
                        }
                        else
                        {
                            decodedChar = String.fromCodePoint(65533);
                        }
                    }
                    else // invalid bytes
                    {
                        decodedChar = String.fromCodePoint(65533);
                    }
                }
                else // invalid bytes
                {
                    decodedChar = String.fromCodePoint(65533);         
                }
            }
            else // invalid bytes
            {
                decodedChar = String.fromCodePoint(65533);
            }

            if (decodedLength == 0)
            {
                decoded = decodedChar;
            }
            else
            {
                decoded += decodedChar;
            }

            decodedLength++;

            if (error == 1)
            {
                decoded += String.fromCodePoint(secondChar);
                decodedLength++;
            }
        }
        else
        {
            dataArray.currentIndex++;
        }
    }
    return decoded;
}

/**
 * @param string {string}
 * @param addZero {boolean} adds a zero terminator at the end
 * @param ensureEven {boolean} ensures even byte count
 * @returns {IndexedByteArray}
 */
export function getStringBytesUtf8(string, addZero = false, ensureEven = false)
{
    const encoder = new TextEncoder();
    const encodedText = encoder.encode(string)
    let len = encodedText.length;
    let pad = len;
    if (addZero)
    {
        pad++;
    }
    if (ensureEven && len % 2 !== 0)
    {
        pad++;
    }
    const arr = new IndexedByteArray(len);
    for (let i = 0; i < len; i++) 
    {
        arr[arr.currentIndex++] = encodedText[i];
    }
    if (pad > len) 
    {
        for (let i = len; i < pad; i++)
        {
            arr[arr.currentIndex++] = 0;
        }
    }
    return arr;
}


/**
 * @param string {string}
 * @param outArray {IndexedByteArray}
 * @param padLength {number}
 * @returns {IndexedByteArray} modified IN PLACE
 */
export function writeStringAsBytes(outArray, string, padLength = 0)
{
    if (padLength > 0)
    {
        if (string.length > padLength)
        {
            string = string.slice(0, padLength);
        }
    }
    for (let i = 0; i < string.length; i++)
    {
        outArray[outArray.currentIndex++] = string.charCodeAt(i);
    }
    
    // pad with zeros if needed
    if (padLength > string.length)
    {
        for (let i = 0; i < padLength - string.length; i++)
        {
            outArray[outArray.currentIndex++] = 0;
        }
    }
    return outArray;
}