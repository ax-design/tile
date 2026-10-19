import { describe, expect, test } from 'bun:test';
import { MAX_TIMER, parseActivationDelayMax, parseTime, parseTimeout } from '../src/delay.js';

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

describe('parseTime', () => {
    test('reads the times of the launch', () => {
        expect(parseTime('450ms')).toBe(450);
        expect(parseTime('5s')).toBe(5000);
        expect(parseTime('0.167s')).toBeCloseTo(167);
    });

    test('null for anything else, so a default applies', () => {
        for (const value of ['', 'none', '450', 'fast', '-5s']) {
            expect(parseTime(value)).toBeNull();
        }
    });
});

test('parseTimeout reads none as no timeout and cuts huge times to the longest timer', () => {
    expect(parseTimeout('none')).toBe(Infinity);
    expect(parseTimeout(' NONE ')).toBe(Infinity);
    expect(parseTimeout('5s')).toBe(5000);
    expect(parseTimeout('3000000s')).toBe(MAX_TIMER);
    expect(parseTimeout('')).toBeNull();
    expect(parseTimeout('forever')).toBeNull();
});
