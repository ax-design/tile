// The launch of a tile (--ax-tile-launch: flip), as Windows 8 starts an app from its tile, measured
// on a 60 fps recording of Windows 8.1: the tile starts to turn at once, and after about 100 ms one
// rectangle grows from the tile to the screen, fast then slow (curve 61 of the Windows theme), for
// the rest of about 620 ms. The tile turns edge-on at 30% of it while it grows toward the middle
// of the screen, then the splash of the app (its color and logo) turns from
// edge-on to face the viewer while it takes the rest of the way, and stays until the app is ready.
// The click that starts it is held and sent on once the splash covers the screen. See the README,
// "Launch".
import { appearance, bezierAt, parseEasing } from '@ax-design/surface';
import type { Bezier, MotionState } from '@ax-design/surface';
import { parseTime, parseTimeout } from './delay.js';
import { shared } from './shared.js';

// The surface of a tile, read by its method (it may come from another copy of surface).
interface MotionTile extends Element {
    motion(state: MotionState | null): void;
}

// Defaults of the parameters (see the README).
const DURATION = 620;
// The growth of the rectangle, fitted to the recording: curve 61 of the Windows theme, after the
// first 16% (100 ms) in which the tile only turns.
const EASING: Bezier = [0.17, 0.55, 0.3, 0.95];
const GROW_SHARE = 0.16;
const FADE = 167;
// The splash stays at least this long once it covers the screen, as an app takes a moment to show
// its first frame (about 150 to 250 ms in the recording). Without it a fast router would take the
// splash away the moment it arrives.
const SPLASH_MIN = 250;
const TIMEOUT = 5000;
// The tile turns edge-on in the first share of the duration, with ease-in; the splash takes the rest,
// turning with a strong ease-out, so it faces the viewer well before it covers the screen.
const TURN_SHARE = 0.3;
const TURN_EASING: Bezier = [0.42, 0, 1, 1];
const SPLASH_TURN_EASING: Bezier = [0.1, 0.9, 0.2, 1];

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
        'position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 2147483647; margin: 0; box-sizing: border-box; overflow: hidden;' +
        ` display: flex; align-items: center; justify-content: center; background: ${color};`;
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
        const minimum = timeOf(tile, '--ax-tile-splash-min', SPLASH_MIN);
        // `none` waits for as long as it takes: Infinity, and no timer below.
        const parsedTimeout = parseTimeout(prop(tile, '--ax-tile-splash-timeout'));
        const timeout = parsedTimeout === null ? TIMEOUT : parsedTimeout;
        const forced = appearance().forcedColors;
        // A transparent splash would show the page through the launch: black, as the default of Windows.
        const resolved = prop(tile, '--ax-tile-splash-color') || (forced ? 'Canvas' : prop(tile, '--ax-fill-color'));
        const splashColor = isTransparent(resolved) ? 'black' : resolved;
        // The perspective of the tile, in its own px. The splash keeps the same ratio of perspective to
        // size as it grows, so the turn looks the same on both sides of the swap.
        const perspective = Math.max(1000, 4 * Math.max(from.width, from.height));
        const depth = perspective / Math.max(1, from.width, from.height);
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

        // When the splash covered the screen: it stays at least `minimum` from then.
        let coveredAt = 0;
        const fadeOut = () => {
            const early = coveredAt + minimum - performance.now();
            if (splash && early > 0) {
                limit = window.setTimeout(fadeOut, early);
                return;
            }
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
            if (isFinite(timeout)) limit = window.setTimeout(settle, timeout);
            if (pending.length) Promise.all(pending.map((p) => p.then(noop, noop))).then(settle);
        };

        const activateNow = () => {
            coveredAt = performance.now();
            tile.dispatchEvent(new CustomEvent('tilelaunchactivate', { bubbles: true, composed: true, detail: { tile, action, url, hold } }));
            const delivered = activate();
            const navigates = delivered && !!url && leavesPage(action, url) && !holds.length && !ready;
            holdSplash(navigates);
        };

        // The rectangle at progress q of the growth: the tile's at 0, the screen at 1.
        const rect = (q: number) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const left = from.left * (1 - q);
            const top = from.top * (1 - q);
            const width = from.width + (w - from.width) * q;
            const height = from.height + (h - from.height) * q;
            return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
        };
        // The tile at progress q, turned by `angle`: scaled to the height of the rectangle and moved to
        // its middle, outside its perspective, so that edge-on it is a line as tall as the rectangle.
        const writeTile = (q: number, angle: number, opacity: number) => {
            const r = rect(q);
            motion.motion({
                rotateY: angle,
                perspective,
                scale: r.height / Math.max(1, from.height),
                x: r.cx - (from.left + from.width / 2),
                y: r.cy - (from.top + from.height / 2),
                opacity,
            });
        };
        // The splash at progress q, turned by `angle` about its middle. Sized by layout, not scaled,
        // so its logo keeps its shape.
        const writeSplash = (el: HTMLElement, q: number, angle: number) => {
            const r = rect(q);
            el.style.left = `${r.left}px`;
            el.style.top = `${r.top}px`;
            el.style.width = `${r.width}px`;
            el.style.height = `${r.height}px`;
            el.style.transform = angle ? `perspective(${depth * Math.max(r.width, r.height)}px) rotateY(${angle}deg)` : '';
        };

        // One frame: the tile grows and turns edge-on, then the splash takes over from the same line,
        // turns to face the viewer and grows to the screen, then the click is sent.
        const tick = () => {
            frame = 0;
            if (over) return;
            const elapsed = performance.now() - t0;
            const growStart = duration * GROW_SHARE;
            const q = elapsed <= growStart ? 0 : bezierAt(easing, Math.min(1, (elapsed - growStart) / (duration - growStart)));
            if (elapsed < turnEnd) {
                writeTile(q, 90 * bezierAt(TURN_EASING, elapsed / turnEnd), 1);
                frame = requestAnimationFrame(tick);
                return;
            }
            if (!splash) {
                // Edge-on from here on, and hidden: the splash goes on from its line.
                writeTile(bezierAt(easing, (TURN_SHARE - GROW_SHARE) / (1 - GROW_SHARE)), 90, 0);
                splash = makeSplash(splashColor, tile);
                document.body.appendChild(splash);
            }
            const back = Math.min(1, (elapsed - turnEnd) / (duration - turnEnd));
            writeSplash(splash, q, -90 * (1 - bezierAt(SPLASH_TURN_EASING, back)));
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
