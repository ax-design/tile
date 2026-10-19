// Reads a <time> of a custom property, in ms or s. Anything else (empty, none, a number without a
// unit, a negative time) is null, so a bad value cannot make a tile wait forever.
export function parseTime(value: string): number | null {
    const match = /^(\d*\.?\d+)(ms|s)$/i.exec(value.trim());
    if (!match) return null;
    const time = parseFloat(match[1]);
    return match[2].toLowerCase() === 's' ? time * 1000 : time;
}

// Reads --ax-tile-activation-delay-max: no cap for anything parseTime refuses.
export function parseActivationDelayMax(value: string): number | null {
    return parseTime(value);
}

// The longest delay a browser timer takes (2^31 - 1 ms, about 24.8 days): a longer one fires at
// once instead.
export const MAX_TIMER = 2147483647;

// Reads --ax-tile-splash-timeout: a <time>, or `none` for no timeout (Infinity). A time past the
// longest timer is cut to it, so that a huge value does not end the splash at once. Anything else
// is null (the default applies).
export function parseTimeout(value: string): number | null {
    if (value.trim().toLowerCase() === 'none') return Infinity;
    const time = parseTime(value);
    return time === null ? null : Math.min(time, MAX_TIMER);
}
