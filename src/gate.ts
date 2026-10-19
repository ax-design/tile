// Delayed activation of <ax-tile>. A press tilts the tile and plays its ripple, and the action runs
// when that feedback is over, as a Windows tile launches its app after the press. The click is
// held on the window in the capture phase, before the action and the page see it, and replayed on
// its target once the feedback has finished. A tile with --ax-tile-launch: flip does not wait: it
// starts its launch (see launch.ts). The gate is one for the whole page (see shared.ts).

import { parseActivationDelayMax } from './delay.js';
import { flips, isLaunching, replay, startLaunch } from './launch.js';
import { shared } from './shared.js';

// Marks tile elements across copies of this package (a brand, not instanceof).
export const TILE_BRAND = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/tile.element') : '@ax-design/tile.element';

// The parts of a tile the gate uses, read by name so that any copy of the element works.
interface Tile extends Element {
    pressTakenOver: boolean;
    pressRemaining(): number;
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
export function inNestedTile(element: Element, tile: Element): boolean {
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

// Sends the held click once the feedback has finished. A keyboard press is measured a frame later.
function activateAfterFeedback(event: MouseEvent, target: EventTarget, tile: Element, keyboard: boolean): void {
    const wait = (ms: number) => {
        const cap = activationDelayMax(tile);
        setTimeout(() => replay(event, target, tile), Math.max(0, cap === null ? ms : Math.min(ms, cap)));
    };
    if (keyboard) requestAnimationFrame(() => wait(remainingOf(tile)));
    else wait(remainingOf(tile));
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
    // A second click during the wait, or during a launch, must not activate the action a second time.
    if (gate.pending.has(tile) || isLaunching(tile)) return swallow(event);

    // The first node of the path, not event.target: a tile inside another component's shadow root
    // would show its host here.
    const target = event.composedPath()[0] || event.target;
    const keyboard = gate.keyboard.has(tile);
    if (flips(tile)) {
        swallow(event);
        gate.pending.add(tile);
        // The launch takes the click and does not wait for the feedback. Canceled, it falls back to the delay.
        if (startLaunch(tile, action, () => replay(event, target, tile), null)) return;
        return activateAfterFeedback(event, target, tile, keyboard);
    }

    // Without a press in progress there is nothing to wait for; a press from the keyboard is measured
    // a frame later, so it is always held.
    const remaining = keyboard ? 0 : remainingOf(tile);
    if (!keyboard && remaining <= 0) return;

    swallow(event);
    gate.pending.add(tile);
    activateAfterFeedback(event, target, tile, keyboard);
}
