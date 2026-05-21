import { describe, expect, it } from 'bun:test';
import { decodeCursor, encodeCursor } from './cursor';

describe('encodeCursor / decodeCursor', () => {
    it('round-trips a (date, id) pair', () => {
        const cursor = encodeCursor('2026-05-20', 'entry-abc-123');

        const decoded = decodeCursor(cursor);

        expect(decoded).toEqual({ date: '2026-05-20', id: 'entry-abc-123' });
    });

    it('returns null for an empty cursor', () => {
        expect(decodeCursor('')).toBeNull();
    });

    it('returns null for a cursor missing the separator', () => {
        const noSeparator = Buffer.from('2026-05-20-entry-1', 'utf8').toString('base64url');

        expect(decodeCursor(noSeparator)).toBeNull();
    });

    it('returns null when one of the parts is empty', () => {
        const emptyDate = Buffer.from('|entry-1', 'utf8').toString('base64url');
        const emptyId = Buffer.from('2026-05-20|', 'utf8').toString('base64url');

        expect(decodeCursor(emptyDate)).toBeNull();
        expect(decodeCursor(emptyId)).toBeNull();
    });

    it('returns null on garbage input', () => {
        // Random non-base64 string. Buffer is permissive, so we exercise both a
        // structurally-decodable-but-meaningless cursor and a clearly invalid one.
        expect(decodeCursor('!!!@@@###')).toBeNull();
    });
});
