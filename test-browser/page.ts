// Browser checks for <ax-tile>: real pointer and key presses come from the driver (run.ts) through
// the steps below. The page sets window.__step, run.ts presses and acks it, then the page goes on.
// Clicks are seen from the document: a click the gate holds never reaches it, a replay does.
import { registerRevealLayer } from '@ax-design/reveal-highlight';
import { setAlwaysUseFallback } from '@ax-design/surface';
import { register } from '../src/index.js';

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}
declare global {
    interface Window {
        __result?: unknown;
        __step?: string;
        __ack?: string;
        __popups?: number;
    }
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const tileOf = (id: string) => byId(id) as HTMLElement & { pressRemaining(): number; press(): void; release(): void; pressTakenOver: boolean; debugState: { local: { pointerType: string; x: number; y: number } | null; tilt: unknown } };
const actionOf = (id: string) => byId(id).querySelector('[slot="action"]') as HTMLElement;
const rectOf = (el: Element) => el.getBoundingClientRect();

// Every click that gets past the gate (a click it holds never gets here), and every replay.
interface Seen {
    at: number;
    replay: boolean;
    tile: string;
    target: string;
    button: number;
    ctrl: boolean;
    meta: boolean;
}
const passed: Seen[] = [];
const bubbled: boolean[] = [];
const auxclicks: number[] = [];
document.addEventListener(
    'click',
    (e) => {
        const target = e.target as Element;
        passed.push({
            at: performance.now(),
            replay: (e as MouseEvent & { axReplay?: boolean }).axReplay === true,
            tile: (target.closest && target.closest('ax-tile') && target.closest('ax-tile')!.id) || '',
            target: target.id || target.tagName.toLowerCase(),
            button: e.button,
            ctrl: e.ctrlKey,
            meta: e.metaKey,
        });
    },
    true
);
document.addEventListener('click', (e) => bubbled.push((e as MouseEvent & { axReplay?: boolean }).axReplay === true));
document.addEventListener('auxclick', (e) => auxclicks.push(e.button), true);

// Forms submit here, and nothing navigates.
let submits = 0;
byId('form').addEventListener('submit', (e) => {
    e.preventDefault();
    submits++;
});

let stepNo = 0;
async function step(name: string) {
    const s = `${name}#${++stepNo}`;
    window.__step = s;
    for (let i = 0; window.__ack !== s; i++) {
        if (i > 1000) throw new Error(`no ack for ${s}`);
        await wait(20);
    }
}
const realKeys = new URLSearchParams(location.search).has('keys');
async function popupCount(): Promise<number> {
    await step('popups');
    return window.__popups || 0;
}

// Waits until `done` holds, up to `max` ms; returns the time it held, or -1.
async function until(done: () => boolean, max: number): Promise<number> {
    const start = performance.now();
    while (!done()) {
        if (performance.now() - start > max) return -1;
        await wait(5);
    }
    return performance.now();
}
const resetHash = () => history.replaceState(null, '', location.pathname + location.search);
const replaysSince = (mark: number) => passed.slice(mark).filter((s) => s.replay);
const heldSince = (mark: number, tile: string) => passed.slice(mark).filter((s) => !s.replay && s.tile === tile);

// A press with the mouse on the tile, released after `hold` ms of feedback; returns when it was released.
async function pressAndRelease(id: string, hold: number): Promise<number> {
    await step(`press-${id}`);
    await wait(hold);
    await step('release');
    return performance.now();
}

async function pointerChecks() {
    // 1. A mouse click on a link tile with a ripple: held, then replayed once, marked as a replay.
    resetHash();
    let mark = passed.length;
    let bubbleMark = bubbled.length;
    await step('press-link');
    await frame();
    await frame();
    const link = tileOf('link');
    const rem = link.pressRemaining();
    await step('release');
    const upAt = performance.now();
    await wait(30);
    check('link: the click is held at once', location.hash !== '#target' && heldSince(mark, 'link').length === 0, `hash ${location.hash}`);
    const changedAt = await until(() => location.hash === '#target', 4000);
    const delay = changedAt < 0 ? -1 : changedAt - upAt;
    check('link: the hash changes after the ripple', changedAt >= 0 && delay <= rem + 100 && delay >= rem - 200, `delay ${delay.toFixed(0)} ms, ripple ${rem.toFixed(0)} ms`);
    const seen = replaysSince(mark);
    check('link: exactly one replay reaches the document bubble, marked axReplay', bubbled.slice(bubbleMark).filter(Boolean).length === 1 && bubbled.slice(bubbleMark).length === 1 && seen.length === 1, `replays ${seen.length}`);

    if (realKeys) {
        // 2. Ctrl, Meta and middle clicks pass at once: they open the link elsewhere, not here. The modifier
        // is held through a real press, so the press has its feedback, as it has with a mouse.
        const modifierClick = async (key: string) => {
            const from = passed.length;
            await step(`down:${key}`);
            await step('press-modifiers');
            await wait(100);
            await step('release');
            await step(`up:${key}`);
            return passed.slice(from);
        };
        const control = await modifierClick('Control');
        check('ctrl click: passes at once, not held', control.some((s) => s.tile === 'modifiers' && s.ctrl && !s.replay), `${control.map((s) => `${s.tile}/${s.replay}/${s.ctrl}`).join(' ')}`);
        const meta = await modifierClick('Meta');
        check('meta click: passes at once, not held', meta.some((s) => s.tile === 'modifiers' && s.meta && !s.replay), `${meta.map((s) => `${s.tile}/${s.replay}/${s.meta}`).join(' ')}`);
        const auxMark = auxclicks.length;
        await step('click:modifiers:1:');
        check('middle click: passes at once (auxclick reaches the page)', auxclicks.slice(auxMark).indexOf(1) >= 0, '');
    }

    // 3. A second click during the wait does not activate the link again.
    resetHash();
    mark = passed.length;
    bubbleMark = bubbled.length;
    await step('press-link');
    await wait(60);
    await step('release');
    await step('press-link');
    await wait(60);
    await step('release');
    const doubled = await until(() => location.hash === '#target', 4000);
    await wait(300);
    const replays = replaysSince(mark).filter((s) => s.tile === 'link').length;
    check('link: a click during the wait is swallowed, the link is activated once', doubled >= 0 && replays === 1 && heldSince(mark, 'link').length === 0 && bubbled.slice(bubbleMark).filter(Boolean).length === 1, `replays ${replays}, passed ${heldSince(mark, 'link').length}`);

    // 4a. A submit button in a form submits once, after the delay.
    const before = submits;
    await pressAndRelease('form-tile', 60);
    await wait(30);
    check('form: no submit at once', submits === before, `submits ${submits - before}`);
    await until(() => submits > before, 4000);
    await wait(300);
    check('form: submits once after the delay', submits - before === 1, `submits ${submits - before}`);

    // 4b. A target="_blank" link opens one popup, after the delay.
    if (realKeys) {
        const popupsBefore = await popupCount();
        await pressAndRelease('blank', 20);
        await wait(50);
        const popupsEarly = await popupCount();
        check('blank link: no popup at once', popupsEarly === popupsBefore, `popups ${popupsEarly - popupsBefore}`);
        await wait(3500);
        const popupsLater = await popupCount();
        check('blank link: opens one popup after the delay', popupsLater - popupsBefore === 1, `popups ${popupsLater - popupsBefore}`);
    }

    // 6b. A tile capped by --ax-tile-activation-delay-max replays after the cap, not the ripple.
    resetHash();
    await step('press-capped');
    await wait(100);
    await step('release');
    const cappedUp = performance.now();
    const cappedAt = await until(() => location.hash === '#capped-target', 2000);
    check('capped tile: replays after the cap (50 ms), not the 8 s ripple', cappedAt >= 0 && cappedAt - cappedUp < 400, `delay ${(cappedAt - cappedUp).toFixed(0)} ms`);

    // 6a. activation="immediate" passes the click at once.
    resetHash();
    mark = passed.length;
    await step('press-immediate');
    await wait(100);
    await step('release');
    await wait(30);
    check('immediate: the click passes at once', location.hash === '#immediate-target' && !replaysSince(mark).length, `hash ${location.hash}`);

    // 5a. A tile without a reveal layer has no feedback but the tilt: the click passes once it is done.
    resetHash();
    mark = passed.length;
    await step('press-plain');
    await wait(100);
    await step('release');
    await wait(30);
    check('no reveal layer: the click passes synchronously', location.hash === '#plain-target' && heldSince(mark, 'plain').length === 1 && !replaysSince(mark).length, `hash ${location.hash}`);

    // 5b. setAlwaysUseFallback(true): no ripple to wait for.
    resetHash();
    mark = passed.length;
    setAlwaysUseFallback(true);
    await frame();
    await step('press-link');
    await wait(100);
    await step('release');
    await wait(30);
    setAlwaysUseFallback(false);
    check('fallback: the click passes synchronously', location.hash === '#target' && heldSince(mark, 'link').length === 1 && !replaysSince(mark).length, `hash ${location.hash}`);
    await frame();

    // 8. A container that took the gesture over (release(), as a drag does): the click is dropped.
    resetHash();
    mark = passed.length;
    await step('press-taken');
    await wait(30);
    tileOf('taken').release();
    const takenOver = tileOf('taken').pressTakenOver;
    await step('release');
    await wait(1000);
    check('taken over: the click after a drag is dropped', takenOver && location.hash !== '#taken-target' && !replaysSince(mark).length && !heldSince(mark, 'taken').length, `takenOver ${takenOver}`);

    // 9a. A button in the content is not delayed: only the action is.
    if (realKeys) {
        // A real press on it, so that the tile has its feedback to wait for, as on the action.
        mark = passed.length;
        await step('pressc-extra-btn');
        await wait(100);
        await step('release');
        check('content button: the click passes at once', passed.slice(mark).some((s) => s.target === 'extra-btn' && !s.replay) && !replaysSince(mark).length, passed.slice(mark).map((s) => `${s.tile}/${s.target}/${s.replay}`).join(' '));
    }

    // 9b. A static tile (no action) gets no press feedback at all.
    await step('press-static');
    await wait(20);
    const staticTile = tileOf('static');
    check('static tile: no press feedback', staticTile.pressRemaining() === 0 && staticTile.debugState.local === null && staticTile.debugState.tilt === null, '');
    await step('release');
    check('static tile: no role set', !staticTile.hasAttribute('role') && !actionOf('static') && !byId('static').getAttribute('role'), '');

    // 10. label="hidden": the name is hidden but stays the accessible name, and the action still covers the tile.
    const hiddenA = byId('hidden-a');
    check('label hidden: the action keeps its name', hiddenA.textContent === 'Hidden name', String(hiddenA.textContent));
    check('label hidden: the name is not shown', getComputedStyle(hiddenA).fontSize === '0px', getComputedStyle(hiddenA).fontSize);
    check('label hidden: the action still covers the tile', sameRect(rectOf(hiddenA), rectOf(byId('hidden'))), '');

    // 11b/11a. Focus: the action covers the tile, and the focus ring layer is on by default.
    byId('focus').scrollIntoView();
    byId('native').scrollIntoView();
    // The layers of a tile come with its first visibility, which IntersectionObserver reports later.
    await wait(100);
    const focusAction = actionOf('focus');
    const focusTile = tileOf('focus');
    check('focus: the action covers the tile', sameRect(rectOf(focusAction), rectOf(focusTile)), '');
    check('focus: the focus ring layer is on by default', !!focusTile.shadowRoot!.querySelector('.layer-focus'), '');
    const nativeTile = tileOf('native');
    check('native: no focus ring layer', !nativeTile.shadowRoot!.querySelector('.layer-focus'), '');
}

const sameRect = (a: DOMRect, b: DOMRect) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

// A tile draws its press only while it is visible, which IntersectionObserver reports a frame later.
async function show(id: string) {
    byId(id).scrollIntoView({ block: 'center' });
    await wait(150);
}

async function keyChecks() {
    // Focus by keyboard first: a focus that follows a key press shows :focus-visible, as a script's
    // focus does after a keyboard focus (Firefox does not count a modifier key as one).
    byId('tab-start').focus();
    await step('down:Tab');
    await step('up:Tab');
    // 11c. Focus ring visible when focused, with the browser outline left on for focus-ring="native".
    await show('focus');
    byId('focus-a').focus();
    await frame();
    check('focus: the browser outline is suppressed while focused', getComputedStyle(byId('focus-a')).outlineStyle === 'none', getComputedStyle(byId('focus-a')).outlineStyle);
    check('focus: the ring is drawn while focused', !!tileOf('focus').shadowRoot!.querySelector('.layer-focus svg') && (tileOf('focus').shadowRoot!.querySelector('.layer-focus svg') as SVGElement).style.display !== 'none', '');
    await show('native');
    byId('native-a').focus();
    await frame();
    const nativeOutline = getComputedStyle(byId('native-a')).outlineStyle;
    check('native: the browser outline is not suppressed', nativeOutline !== 'none' && byId('native-a').matches(':focus-visible'), nativeOutline);

    // 7a/7b. Enter on a focused link presses the tile from its center and navigates after the ripple.
    resetHash();
    await show('link');
    const link = tileOf('link');
    link.querySelector('a')!.focus();
    let mark = passed.length;
    await step('down:Enter');
    const keyDown = performance.now();
    await frame();
    await frame();
    const local = link.debugState.local;
    const remaining = link.pressRemaining();
    check('keyboard: Enter presses the tile from its center', !!local && local.pointerType === 'keyboard' && Math.abs(local.x - link.offsetWidth / 2) < 1 && Math.abs(local.y - link.offsetHeight / 2) < 1 && remaining > 0, `${local && local.pointerType} ${remaining.toFixed(0)} ms`);
    await step('up:Enter');
    const keyChanged = await until(() => location.hash === '#target', 4000);
    // The Enter click is the release, so the ripple is measured as released now: the wait is about the
    // remaining time read in the first frame after the press.
    const delay = keyChanged - keyDown;
    check('keyboard: Enter navigates after the ripple', keyChanged >= 0 && delay >= remaining - 100 && delay <= remaining + 250 && replaysSince(mark).length === 1, `delay ${delay.toFixed(0)} ms, ripple ${remaining.toFixed(0)} ms`);

    // 7c. Space on a focused button presses it and submits once, after the delay.
    const before = submits;
    await show('form-tile');
    actionOf('form-tile').focus();
    await step('down: ');
    await frame();
    await frame();
    check('keyboard: Space presses a button', tileOf('form-tile').debugState.local?.pointerType === 'keyboard', '');
    await step('up: ');
    await wait(30);
    check('keyboard: Space on a button submits after the delay, not at once', submits === before, '');
    await until(() => submits > before, 4000);
    await wait(300);
    check('keyboard: Space on a button submits once', submits - before === 1, `submits ${submits - before}`);

    // 7d. Space on a link does nothing special: no press, no click.
    resetHash();
    mark = passed.length;
    await show('keys-link');
    actionOf('keys-link').focus();
    await step('down: ');
    await frame();
    await frame();
    const keysLocal = tileOf('keys-link').debugState.local;
    check('keyboard: Space on a link does not press the tile', !(keysLocal && keysLocal.pointerType === 'keyboard') && tileOf('keys-link').pressRemaining() === 0, `${keysLocal && keysLocal.pointerType}`);
    await step('up: ');
    await wait(100);
    check('keyboard: Space on a link does not activate it', location.hash !== '#keys-link-target' && passed.slice(mark).every((s) => s.tile !== 'keys-link'), '');
}

async function reducedChecks() {
    // Reduced motion: the tilt is set at once, so the tile has no feedback to wait for.
    resetHash();
    const mark = passed.length;
    await step('press-plain');
    await frame();
    check('reduced motion: no feedback to wait for', tileOf('plain').pressRemaining() === 0, `${tileOf('plain').pressRemaining()}`);
    await step('release');
    await wait(30);
    check('reduced motion: the click passes synchronously', location.hash === '#plain-target' && heldSince(mark, 'plain').length === 1, `hash ${location.hash}`);
}

async function run() {
    registerRevealLayer();
    register();
    await wait(50);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await reducedChecks();
    } else {
        await pointerChecks();
        if (realKeys) await keyChecks();
    }
    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
