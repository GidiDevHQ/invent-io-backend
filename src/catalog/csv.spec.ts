import { parseCsv } from './csv';

describe('parseCsv', () => {
    it('parses a simple header + rows', () => {
        expect(parseCsv('name,price,cost\nSoap,150,90\nRice,500,400')).toEqual([
            ['name', 'price', 'cost'],
            ['Soap', '150', '90'],
            ['Rice', '500', '400'],
        ]);
    });

    it('handles quoted fields with commas and escaped quotes', () => {
        expect(parseCsv('name,note\n"Soap, 500g","He said ""hi"""')).toEqual([
            ['name', 'note'],
            ['Soap, 500g', 'He said "hi"'],
        ]);
    });

    it('handles newlines inside quotes', () => {
        expect(parseCsv('name\n"line1\nline2"')).toEqual([['name'], ['line1\nline2']]);
    });

    it('treats CRLF and a trailing newline correctly (no empty final record)', () => {
        expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('strips a leading BOM and keeps empty trailing fields', () => {
        expect(parseCsv('﻿a,b,\nc,,e')).toEqual([
            ['a', 'b', ''],
            ['c', '', 'e'],
        ]);
    });

    it('skips blank lines', () => {
        expect(parseCsv('a\n\nb')).toEqual([['a'], ['b']]);
    });
});
