/**
 * A small RFC 4180 CSV parser — no dependency, because the import format is a
 * handful of known columns. Handles quoted fields, commas and newlines inside
 * quotes, escaped quotes (""), and both CRLF and LF line endings. A trailing
 * newline does not produce an empty final record.
 */
export function parseCsv(input: string): string[][] {
    const rows: string[][] = [];
    let field = '';
    let record: string[] = [];
    let inQuotes = false;
    let sawAny = false; // did the current record receive any char/field?

    const text = input.replace(/^﻿/, ''); // strip a leading BOM

    const pushField = () => {
        record.push(field);
        field = '';
    };
    const pushRecord = () => {
        pushField();
        rows.push(record);
        record = [];
        sawAny = false;
    };

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"'; // escaped quote
                    i++;
                } else {
                    inQuotes = false; // closing quote
                }
            } else {
                field += c;
            }
            continue;
        }

        if (c === '"') {
            inQuotes = true;
            sawAny = true;
        } else if (c === ',') {
            pushField();
            sawAny = true;
        } else if (c === '\r') {
            // swallow; the \n (or end) ends the record
            if (sawAny || field.length > 0) pushRecord();
        } else if (c === '\n') {
            if (sawAny || field.length > 0) pushRecord();
        } else {
            field += c;
            sawAny = true;
        }
    }
    // Flush the last record if the file didn't end on a newline.
    if (sawAny || field.length > 0) pushRecord();

    return rows;
}
