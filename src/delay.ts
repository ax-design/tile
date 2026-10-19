// Reads --ax-tile-activation-delay-max, a <time> that caps the wait of a delayed activation.
// Anything else (empty, none, a number without a unit, a negative time) means no cap, so a
// bad value cannot make a tile wait forever.
export function parseActivationDelayMax(value: string): number | null {
    const match = /^(\d*\.?\d+)(ms|s)$/i.exec(value.trim());
    if (!match) return null;
    const time = parseFloat(match[1]);
    return match[2].toLowerCase() === 's' ? time * 1000 : time;
}
