// The launch of a tile (--ax-tile-launch: flip), as Windows 8 starts an app from its tile: the tile
// turns edge-on, then the splash of the app (its color and logo) turns to face the viewer while it
// grows from the tile's rectangle to the screen, and stays until the app is ready. The click that
// starts it is held and sent on once the splash covers the screen. See the README, "Launch".
import { appearance, bezierAt, parseEasing } from '@ax-design/surface';
import type { Bezier, MotionState } from '@ax-design/surface';
import { parseTime } from './delay.js';
import { shared } from './shared.js';

// The surface of a tile, read by its method (it may come from another copy of surface).
interface MotionTile extends Element {
    motion(state: MotionState | null): void;
}

// Defaults of the parameters (see the README).
const DURATION = 450;
const EASING: Bezier = [0.1, 0.9, 0.2, 1];
const FADE = 167;
const TIMEOUT = 5000;
// The tile turns edge-on in the first share of the duration, with ease-in; the splash takes the rest.
const TURN_SHARE = 0.3;
const TURN_EASING: Bezier = [0.42, 0, 1, 1];

const noop = () => undefined;

function prop(element: Element, name: string): string {
    return getComputedStyle(element).getPropertyValue(name).trim();
}

function timeOf(element: Element, name: string, fallback: number): number {
    const time = parseTime(prop(element, name));
    return time === null ? fallback : time;
}

// True when the tile launches with the flip. Any other value keeps the delayed activation.
export function flips(tile: Element): boolean {
    return prop(tile, '--ax-tile-launch') === 'flip';
}

export function isLaunching(tile: Element): boolean {
    return shared().launching.has(tile);
}

// Sends a click to the target, as a click the browser then acts on (a link navigates, a submit
// button submits). It is marked as a replay, so that the analytics of the page can skip it. `source`
// is the click that was held; tile.launch() has none, and the click carries no position.
export function replay(source: MouseEvent | null, target: EventTarget, tile: Element): boolean {
    const gate = shared();
    gate.pending.delete(tile);
    if (!tile.isConnected) return false;
    const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: source ? source.detail : 0,
        screenX: source ? source.screenX : 0,
        screenY: source ? source.screenY : 0,
        clientX: source ? source.clientX : 0,
        clientY: source ? source.clientY : 0,
        button: 0,
        buttons: 0,
    });
    (click as MouseEvent & { axReplay?: boolean }).axReplay = true;
    gate.replays.add(click);
    // False when a listener prevented the click: a router took it.
    return target.dispatchEvent(click);
}

// True for a link that the browser navigates to when clicked: an http(s) URL of another document (not a
// hash of this page), with no download and no other target. A mailto or a javascript link keeps the page.
function leavesPage(action: Element, url: string): boolean {
    const target = action.getAttribute('target');
    if (action.hasAttribute('download') || (target && target !== '_self')) return false;
    if (!/^https?:/.test(url)) return false;
    return url.split('#')[0] !== location.href.split('#')[0];
}

// Whether a color is fully transparent, as the computed background of an element with it is.
function isTransparent(color: string): boolean {
    const probe = document.createElement('div');
    probe.style.backgroundColor = color;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const m = /^rgba?\((.*)\)$/.exec(computed);
    if (!m) return computed === 'transparent';
    const parts = m[1].split(/[ ,\/]+/).filter(Boolean);
    return parts.length === 4 && parseFloat(parts[3]) === 0;
}

// The default prefetch: a link that the browser follows in this window (same origin, no download,
// no other target) is fetched while the tile turns, so that its page is there when the splash goes.
// Once per URL.
function prefetch(action: Element, url: string): void {
    const prefetched = shared().prefetched;
    const target = action.getAttribute('target');
    if (prefetched.has(url) || action.hasAttribute('download') || (target && target !== '_self')) return;
    const link = new URL(url);
    if ((link.protocol !== 'http:' && link.protocol !== 'https:') || link.origin !== location.origin) return;
    prefetched.add(url);
    const element = document.createElement('link');
    element.rel = 'prefetch';
    element.href = url;
    document.head.appendChild(element);
}

// The splash takes the screen of the page, in the color of the app, with the content of its template.
// It sits on the body: a transform on an ancestor of the tile would break its position: fixed.
function makeSplash(color: string, tile: Element): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
        'position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 2147483647; margin: 0; box-sizing: border-box;' +
        ` display: flex; align-items: center; justify-content: center; background: ${color}; transform-origin: 0 0;`;
    const template = tile.querySelector(':scope > template[slot="splash"]') as HTMLTemplateElement | null;
    if (template) el.appendChild(template.content.cloneNode(true));
    return el;
}

// Starts the launch of a tile. `activate` sends the click on once the splash covers the screen: the
// held click, or the action for tile.launch(). `ready` holds the splash until it has settled.
// Returns null when tilelaunchstart was canceled, with nothing started: the caller then activates
// the action as without a launch. Otherwise the promise resolves when the splash is gone.
export function startLaunch(tile: Element, action: Element, activate: () => boolean, ready: Promise<unknown> | null): Promise<void> | null {
    const gate = shared();
    const url = action.localName === 'a' && action.hasAttribute('href') ? (action as HTMLAnchorElement).href : null;
    const holds: Promise<unknown>[] = [];
    const hold = (promise: Promise<unknown>) => {
        holds.push(Promise.resolve(promise));
    };
    let noPrefetch = false;
    // Marked before the event, so that a listener calling launch() again is refused.
    gate.launching.add(tile);
    const start = new CustomEvent('tilelaunchstart', {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: { tile, action, url, hold, preventPrefetch: () => (noPrefetch = true) },
    });
    tile.dispatchEvent(start);
    if (start.defaultPrevented) {
        gate.launching.delete(tile);
        return null;
    }
    if (url && !noPrefetch) prefetch(action, url);

    return new Promise<void>((resolve) => {
        const motion = tile as MotionTile;
        const reduced = appearance().reducedMotion;
        // Read now, before the tile turns: the splash grows from where the tile was.
        const from = tile.getBoundingClientRect();
        const duration = Math.max(1, timeOf(tile, '--ax-tile-launch-duration', DURATION));
        const turnEnd = duration * TURN_SHARE;
        const easing = parseEasing(prop(tile, '--ax-tile-launch-easing')) || EASING;
        const fade = reduced ? 0 : timeOf(tile, '--ax-tile-splash-fade', FADE);
        const timeout = timeOf(tile, '--ax-tile-splash-timeout', TIMEOUT);
        const forced = appearance().forcedColors;
        // A transparent splash would show the page through the launch: black, as the default of Windows.
        const resolved = prop(tile, '--ax-tile-splash-color') || (forced ? 'Canvas' : prop(tile, '--ax-fill-color'));
        const splashColor = isTransparent(resolved) ? 'black' : resolved;
        // The perspective of the splash spans the screen, so that its edges never reach the eye.
        const splashPerspective = Math.max(1000, 4 * Math.max(window.innerWidth, window.innerHeight));
        const perspective = Math.max(1000, 4 * Math.max(from.width, from.height));
        const t0 = performance.now();
        let over = false;
        let frame = 0;
        let limit = 0;
        let splash: HTMLElement | null = null;

        // Ends the launch: the splash goes at once, the tile is turned back and the launch is over.
        const end = (reason: 'done' | 'restore') => {
            if (over) return;
            over = true;
            cancelAnimationFrame(frame);
            clearTimeout(limit);
            window.removeEventListener('pageshow', onPageShow);
            if (splash) splash.remove();
            splash = null;
            motion.motion(null);
            gate.launching.delete(tile);
            tile.dispatchEvent(new CustomEvent('tilelaunchend', { bubbles: true, composed: true, detail: { tile, action, url, reason } }));
            resolve();
        };
        // Back and forward cache: a page restored while a launch runs has no launch left to finish.
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) end('restore');
        };
        window.addEventListener('pageshow', onPageShow);

        const fadeOut = () => {
            if (!splash || fade <= 0) return end('done');
            const el = splash;
            const fadeStart = performance.now();
            const step = () => {
                const t = Math.min(1, (performance.now() - fadeStart) / fade);
                el.style.opacity = String(1 - t);
                if (t < 1) frame = requestAnimationFrame(step);
                else end('done');
            };
            step();
        };

        // The splash stays until the held promises have settled, or until the timeout is over.
        // `navigates`: the browser is leaving the page, so the splash stays until it does (a full page
        // navigation keeps the last frame until the next page paints). It ends at the timeout instead,
        // for a navigation that never happens (a 204, a canceled one).
        const holdSplash = (navigates: boolean) => {
            const pending = holds.concat(ready ? [ready] : []);
            if (!pending.length && !navigates) {
                frame = requestAnimationFrame(fadeOut);
                return;
            }
            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                clearTimeout(limit);
                if (!over) fadeOut();
            };
            limit = window.setTimeout(settle, timeout);
            if (pending.length) Promise.all(pending.map((p) => p.then(noop, noop))).then(settle);
        };

        const activateNow = () => {
            tile.dispatchEvent(new CustomEvent('tilelaunchactivate', { bubbles: true, composed: true, detail: { tile, action, url, hold } }));
            const delivered = activate();
            const navigates = delivered && !!url && leavesPage(action, url) && !holds.length && !ready;
            holdSplash(navigates);
        };

        // Rectangle of the splash at progress p: the tile's at 0, the screen at 1. The splash is in the
        // screen box, scaled and moved with its origin at the top left, and turned about the center.
        const writeSplash = (el: HTMLElement, p: number) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const left = from.left * (1 - p);
            const top = from.top * (1 - p);
            const width = from.width + (w - from.width) * p;
            const height = from.height + (h - from.height) * p;
            const cx = left + width / 2;
            const cy = top + height / 2;
            const angle = -90 * (1 - p);
            el.style.transform =
                `translate(${cx}px, ${cy}px) perspective(${splashPerspective}px) rotateY(${angle}deg) translate(${-cx}px, ${-cy}px)` +
                ` translate(${left}px, ${top}px) scale(${width / w}, ${height / h})`;
        };

        // One frame: the tile turns, then the splash turns and grows, then the click is sent.
        const tick = () => {
            frame = 0;
            if (over) return;
            const elapsed = performance.now() - t0;
            if (elapsed < turnEnd) {
                motion.motion({ rotateY: 90 * bezierAt(TURN_EASING, elapsed / turnEnd), perspective });
                frame = requestAnimationFrame(tick);
                return;
            }
            if (!splash) {
                // Edge-on, the tile is hidden by the splash from here on.
                motion.motion({ rotateY: 90, perspective });
                splash = makeSplash(splashColor, tile);
                document.body.appendChild(splash);
            }
            writeSplash(splash, bezierAt(easing, Math.min(1, (elapsed - turnEnd) / (duration - turnEnd))));
            if (elapsed < duration) frame = requestAnimationFrame(tick);
            else activateNow();
        };

        if (reduced) {
            // Reduced motion: no turn and no fade. The splash covers the screen at once; the click
            // follows on the next frame.
            splash = makeSplash(splashColor, tile);
            document.body.appendChild(splash);
            frame = requestAnimationFrame(() => {
                frame = 0;
                activateNow();
            });
        } else {
            tick();
        }
    });
}
