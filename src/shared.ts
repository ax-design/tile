// The state of the gate (see gate.ts) and of the launches (see launch.ts). The gate is one for the
// whole page, so it lives on globalThis: several copies of this package share it.

const GATE = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/tile.gate.v1') : '@ax-design/tile.gate.v1';

export interface Gate {
    installed: boolean;
    // Clicks this gate replayed: they pass the gate untouched.
    replays: WeakSet<Event>;
    // Tiles with an activation waiting for its feedback.
    pending: WeakSet<Element>;
    // Tiles whose keyboard press started in the current task.
    keyboard: WeakSet<Element>;
    // Tiles with a launch running (from its start to the end of the splash).
    launching: WeakSet<Element>;
    // The URLs prefetched by launches, so that each is prefetched once.
    prefetched: Set<string>;
}

// globalThis is not in Chrome 70, so a page without it gets the window.
export function shared(): Gate {
    const root: any = typeof globalThis !== 'undefined' ? globalThis : window;
    if (!root[GATE]) {
        root[GATE] = {
            installed: false,
            replays: new WeakSet<Event>(),
            pending: new WeakSet<Element>(),
            keyboard: new WeakSet<Element>(),
            launching: new WeakSet<Element>(),
            prefetched: new Set<string>(),
        };
    }
    return root[GATE] as Gate;
}
