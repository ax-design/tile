// Delayed activation of <ax-tile>. A press tilts the tile and plays its ripple, and the action runs
// when that feedback is over, as a Windows tile launches its app after the press. The click is
// held on the window in the capture phase, before the action and the page see it, and replayed on
// its target once the feedback has finished. The gate is one for the whole page, so it lives on
// globalThis: several copies of this package share it.

import { parseActivationDelayMax } from './delay.js';

// Marks tile elements across copies of this package (a brand, not instanceof).
export const TILE_BRAND = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/tile.element') : '@ax-design/tile.element';
const GATE = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/tile.gate.v1') : '@ax-design/tile.gate.v1';

// The parts of a tile the gate uses, read by name so that any copy of the element works.
interface Tile extends Element {
    pressTakenOver: boolean;
    pressRemaining(): number;
}

interface Gate {
    installed: boolean;
    // Clicks this gate replayed: they pass the gate untouched.
    replays: WeakSet<Event>;
    // Tiles with an activation waiting for its feedback.
    pending: WeakSet<Element>;
    // Tiles whose keyboard press started in the current task.
    keyboard: WeakSet<Element>;
}

// globalThis is not in Chrome 70, so a page without it gets the window.
function shared(): Gate {
    const root: any = typeof globalThis !== 'undefined' ? globalThis : window;
    if (!root[GATE]) {
        root[GATE] = { installed: false, replays: new WeakSet<Event>(), pending: new WeakSet<Element>(), keyboard: new WeakSet<Element>() };
    }
    return root[GATE] as Gate;
}

// Called when the first tile connects. Capture on the window: the gate runs before any listener of
// the page, so a held click never reaches the action or the listeners of the page.
export function installGate(): void {
    const gate = shared();
    if (gate.installed) return;
    gate.installed = true;
    window.addEventListener('click', onClick, true);
}

// A key press started in this task. The surface has not drawn it yet, so its remaining time reads 0
// until the next frame; the gate measures after one.
export function markKeyboardPress(tile: Element): void {
    const gate = shared();
    gate.keyboard.add(tile);
    requestAnimationFrame(() => gate.keyboard.delete(tile));
}

// A link or a button that cannot be used now.
export function isDisabled(action: Element): boolean {
    return (action as HTMLButtonElement).disabled === true || action.getAttribute('aria-disabled') === 'true';
}

function swallow(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
}

// The action of the tile the click is on: the element with slot="action" in the light DOM of a tile.
function actionOf(event: Event): { action: Element; tile: Element } | null {
    for (const node of event.composedPath()) {
        if ((node as Node).nodeType !== 1) continue;
        const element = node as Element;
        const parent = element.parentElement;
        if (element.getAttribute('slot') === 'action' && parent && (parent as any)[TILE_BRAND] === true) {
            return { action: element, tile: parent };
        }
    }
    return null;
}

// True when a tile sits between the element and `tile`: its press is that tile's business.
function inNestedTile(element: Element, tile: Element): boolean {
    for (let n = element.parentElement; n && n !== tile; n = n.parentElement) {
        if ((n as any)[TILE_BRAND] === true) return true;
    }
    return false;
}

// Milliseconds until the feedback of the tile has finished: its own surface and every surface in its
// light DOM. Shadow roots are not searched, as a surface there is not part of the tile's press.
function remainingOf(tile: Element): number {
    let ms = (tile as Tile).pressRemaining();
    const all = tile.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const element = all[i] as Element & { pressRemaining?: () => number };
        if (typeof element.pressRemaining === 'function' && !inNestedTile(element, tile)) {
            ms = Math.max(ms, element.pressRemaining());
        }
    }
    return ms;
}

function activationDelayMax(tile: Element): number | null {
    return parseActivationDelayMax(getComputedStyle(tile).getPropertyValue('--ax-tile-activation-delay-max'));
}

// Sends the held click to its target, as a click that the browser then acts on (a link navigates,
// a submit button submits). The replay is marked, so that the analytics of the page can skip it.
function replay(event: MouseEvent, target: EventTarget, tile: Element): void {
    const gate = shared();
    gate.pending.delete(tile);
    if (!tile.isConnected) return;
    const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: event.detail,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        button: 0,
        buttons: 0,
    });
    (click as MouseEvent & { axReplay?: boolean }).axReplay = true;
    gate.replays.add(click);
    target.dispatchEvent(click);
}

function onClick(event: MouseEvent): void {
    const gate = shared();
    if (gate.replays.has(event)) return;
    const found = actionOf(event);
    if (!found) return;
    const { action, tile } = found;
    // Clicks that are not a plain press pass untouched: modified, secondary and handled ones, disabled
    // actions, and tiles that ask for immediate activation.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    if (isDisabled(action) || tile.getAttribute('activation') === 'immediate') return;
    // A container took the gesture over (a drag, see release()): the click that ends it is dropped.
    if ((tile as Tile).pressTakenOver) return swallow(event);
    // A second click during the wait must not activate the action a second time.
    if (gate.pending.has(tile)) return swallow(event);

    const keyboard = gate.keyboard.has(tile);
    // Without a press in progress there is nothing to wait for; a press from the keyboard is measured
    // a frame later, so it is always held.
    const remaining = keyboard ? 0 : remainingOf(tile);
    if (!keyboard && remaining <= 0) return;

    // The first node of the path, not event.target: a tile inside another component's shadow root
    // would show its host here.
    const target = event.composedPath()[0] || event.target;
    swallow(event);
    gate.pending.add(tile);
    const wait = (ms: number) => {
        const cap = activationDelayMax(tile);
        setTimeout(() => replay(event, target, tile), Math.max(0, cap === null ? ms : Math.min(ms, cap)));
    };
    if (keyboard) requestAnimationFrame(() => wait(remainingOf(tile)));
    else wait(remaining);
}
