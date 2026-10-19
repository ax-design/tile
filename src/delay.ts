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
