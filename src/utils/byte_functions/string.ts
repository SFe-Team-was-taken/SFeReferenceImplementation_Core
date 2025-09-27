import { IndexedByteArray } from "../indexed_array";

/**
 * Reads bytes as an ASCII string. This version works with any numeric array.
 * @param dataArray the array to read from.
 * @param bytes the amount of bytes to read.
 * @param offset the offset in the array to start reading from.
 * @returns the string.
 */
export function readBinaryString(
    dataArray: ArrayLike<number>,
    bytes = dataArray.length,
    offset = 0
) {
    let string = "";
    for (let i = 0; i < bytes; i++) {
        const byte = dataArray[offset + i];
        if (byte === 0) {
            return string;
        }

        string += String.fromCharCode(byte);
    }
    return string;
}

/**
 * Reads bytes as an ASCII string from an IndexedByteArray.
 * @param dataArray the IndexedByteArray to read from.
 * @param bytes the amount of bytes to read.
 * @returns the string.
 */
export function readBinaryStringIndexed(
    dataArray: IndexedByteArray,
    bytes: number
) {
    const startIndex = dataArray.currentIndex;
    dataArray.currentIndex += bytes;
    return readBinaryString(dataArray, bytes, startIndex);
}

/**
 * Gets ASCII bytes from string.
 * @param string the string.
 * @param addZero adds a zero terminator at the end.
 * @param ensureEven ensures even byte count.
 * @returns the binary data.
 */
export function getStringBytes(
    string: string,
    addZero = false,
    ensureEven = false
): IndexedByteArray {
    let len = string.length;
    if (addZero) {
        len++;
    }
    if (ensureEven && len % 2 !== 0) {
        len++;
    }
    const arr = new IndexedByteArray(len);
    writeBinaryStringIndexed(arr, string);
    return arr;
}

/**
 * Gets UTF-8 bytes from string.
 * @param string the string.
 * @param addZero adds a zero terminator at the end.
 * @param ensureEven ensures even byte count.
 * @returns the binary data.
 */
export function getStringBytesUtf8(
    string: string,
    addZero = false,
    ensureEven = false
): IndexedByteArray {
    let len = string.length;
    if (addZero) {
        len++;
    }
    if (ensureEven && len % 2 !== 0) {
        len++;
    }
    const arr = new IndexedByteArray(len);
    writeBinaryStringIndexedUtf8(arr, string);
    return arr;
}

/**
 * Writes ASCII bytes into a specified array.
 * @param string the string.
 * @param outArray the target array
 * @param padLength pad with zeros if the string is shorter
 * @returns modified _in-place_
 */
export function writeBinaryStringIndexed(
    outArray: IndexedByteArray,
    string: string,
    padLength = 0
): IndexedByteArray {
    if (padLength > 0) {
        if (string.length > padLength) {
            string = string.slice(0, padLength);
        }
    }
    for (let i = 0; i < string.length; i++) {
        outArray[outArray.currentIndex++] = string.charCodeAt(i);
    }

    // Pad with zeros if needed
    if (padLength > string.length) {
        for (let i = 0; i < padLength - string.length; i++) {
            outArray[outArray.currentIndex++] = 0;
        }
    }
    return outArray;
}

/**
 * Writes UTF-8 bytes into a specified array.
 * @param string the string.
 * @param outArray the target array
 * @param padLength pad with zeros if the string is shorter
 * @returns modified _in-place_
 */
export function writeBinaryStringIndexedUtf8(
    outArray: IndexedByteArray,
    string: string,
    padLength = 0
): IndexedByteArray {
    const encoder = new TextEncoder();
    let encodedText = encoder.encode(string);
    let len = encodedText.length;

    if (padLength > 0) {
        if (len > padLength) {
            encodedText = encodedText.slice(0, padLength);
        }
    }
    for (let i = 0; i < len; i++) {
        outArray[outArray.currentIndex++] = encodedText[i];
    }

    // Pad with zeros if needed
    if (padLength > len) {
        for (let i = 0; i < padLength - len; i++) {
            outArray[outArray.currentIndex++] = 0;
        }
    }
    return outArray;
}

/**
 * This function decodes a UTF-8 string without using TextDecoder. This is done because AudioWorkletGlobalScope does not support the TextDecoder.
 * @param utf8Array {IndexedByteArray}
 * @returns {string}
 */
export function decodeUtf8(utf8Array: IndexedByteArray)
{
    let decoded;
    let dataArray = new IndexedByteArray(utf8Array.length);
    let utf8Char = new Uint8Array(4);
    let decodedChar = " ";
    let decodedLength = 0;
    let error = 0;
    let secondChar = 0;

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
                        if (decodedPoint >= 55296 && decodedPoint <= 57343) // UTF-16 surrogates are invalid
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
