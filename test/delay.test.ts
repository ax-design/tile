import { describe, expect, test } from 'bun:test';
import { parseActivationDelayMax } from '../src/delay.js';

describe('parseActivationDelayMax', () => {
    test('reads milliseconds and seconds', () => {
        expect(parseActivationDelayMax('50ms')).toBe(50);
        expect(parseActivationDelayMax(' 0.5s ')).toBe(500);
        expect(parseActivationDelayMax('2S')).toBe(2000);
        expect(parseActivationDelayMax('0ms')).toBe(0);
    });

    test('no cap for anything else', () => {
        for (const value of ['', 'none', '50', '-1ms', '1e2ms', 'abc', '50 px', '.']) {
            expect(parseActivationDelayMax(value)).toBeNull();
        }
    });
});
