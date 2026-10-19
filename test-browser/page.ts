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

// A surface inside a tile (a light over a picture) shares the tile's press: the action covers it, so
// the pointer never reaches it.
async function overlayChecks() {
    await show('overlay');
    resetHash();
    const light = byId('overlay-light') as HTMLElement & { pressRemaining(): number; debugState: { local: { pressed: boolean } | null } };
    await step('press-overlay');
    await frame();
    await frame();
    const local = light.debugState.local;
    check('overlay: the surface inside the tile is pressed with it', !!local && local.pressed === true, JSON.stringify(local));
    await step('release');
    await frame();
    const rem = light.pressRemaining();
    check('overlay: its ripple counts toward the delay', rem > 0, `ms ${rem}`);
    await wait(30);
    check('overlay: the click waits for that ripple', location.hash !== '#overlay-target', location.hash);
    check('overlay: and goes on after it', (await until(() => location.hash === '#overlay-target', 4000)) >= 0, location.hash);
    resetHash();
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
    await wait(200);
    await step('release');
    await wait(30);
    check('no reveal layer: the click passes synchronously', location.hash === '#plain-target' && heldSince(mark, 'plain').length === 1 && !replaysSince(mark).length, `hash ${location.hash}`);

    // 5b. setAlwaysUseFallback(true): no ripple to wait for.
    resetHash();
    mark = passed.length;
    setAlwaysUseFallback(true);
    await frame();
    await step('press-link');
    await wait(200);
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
    {
        const styled = byId('hidden-styled-a');
        const size = getComputedStyle(styled).fontSize;
        check('label="hidden" wins over a font-size the page gives the action', size === '0px' && styled.textContent === 'Styled name', size);
    }
    {
        // The focus layer draws the ring; an outline the page gives focused links must not add a second.
        const focusStyled = byId('focus-styled-a');
        focusStyled.focus();
        const style = getComputedStyle(focusStyled).outlineStyle;
        focusStyled.blur();
        check('the focus layer wins over an outline the page gives the action', style === 'none', style);
    }

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

// The launch events of the tiles, with what the page shows at each: the splashes, the motion of the
// tile and the clicks the button of the page has had.
interface LaunchEvent {
    type: string;
    at: number;
    tile: string;
    url: string | null;
    reason: string;
    splashes: number;
    splash: DOMRect | null;
    motion: unknown;
    clicks: number;
}
const launchEvents: LaunchEvent[] = [];
let buttonClicks = 0;
for (const type of ['tilelaunchstart', 'tilelaunchactivate', 'tilelaunchend']) {
    document.addEventListener(type, (e) => {
        const d = (e as CustomEvent).detail;
        launchEvents.push({
            type,
            at: performance.now(),
            tile: d.tile.id,
            url: d.url,
            reason: d.reason || '',
            splashes: splashesNow().length,
            splash: splashesNow()[0] ? splashesNow()[0].getBoundingClientRect() : null,
            motion: d.tile.debugState.motion,
            clicks: buttonClicks,
        });
    });
}
byId('launch-btn').addEventListener('click', () => buttonClicks++);
// A router-like listener: it takes the replayed click of its link and prevents the navigation.
document.addEventListener('click', (e) => {
    const target = e.target as Element;
    if (target.closest && target.closest('#launch-router') && (e as MouseEvent & { axReplay?: boolean }).axReplay) e.preventDefault();
});
// What the page holds on activation, by tile id; a tile in here keeps its splash until the promise settles.
const holdOn: { [id: string]: () => Promise<unknown> } = {};
document.addEventListener('tilelaunchstart', (e) => {
    const id = (e.target as Element).id;
    if (id === 'launch-cancel') e.preventDefault();
    if (id === 'launch-nopf') (e as CustomEvent).detail.preventPrefetch();
});
document.addEventListener('tilelaunchactivate', (e) => {
    const make = holdOn[(e.target as Element).id];
    if (make) (e as CustomEvent).detail.hold(make());
});

type LaunchTile = HTMLElement & { launch(ready?: Promise<unknown>): Promise<void>; motion(state: unknown): void; debugState: { motion: { rotateY?: number } | null } };
const launchTileOf = (id: string) => byId(id) as LaunchTile;
const eventOf = (tile: string, type: string, from: number) => launchEvents.slice(from).find((e) => e.tile === tile && e.type === type);
// The splashes: the children of the body that are hidden from assistive technology.
function splashesNow(): HTMLElement[] {
    return Array.from(document.body.children).filter((el) => el.getAttribute('aria-hidden') === 'true') as HTMLElement[];
}
// Presses a launch tile and releases it, then waits for the end of its launch. Returns the event mark.
async function launchOnce(id: string): Promise<number> {
    resetHash();
    const mark = launchEvents.length;
    await show(id);
    await step(`press-${id}`);
    await wait(100);
    await step('release');
    await until(() => !!eventOf(id, 'tilelaunchend', mark), 4000);
    return mark;
}
const prefetchesOf = (url: string) => Array.from(document.head.querySelectorAll('link[rel="prefetch"]')).filter((l) => (l as HTMLLinkElement).href === url).length;

// The default duration of the launch, and the least time the splash stays once it covers the screen.
const LAUNCH = 620;
const SPLASH_MIN = 250;

async function launchChecks() {
    // 1. A click on a launch tile: the tile turns, the splash comes up, the link is followed at the end
    // of the flip, and the splash goes after its fade.
    resetHash();
    const mark = launchEvents.length;
    const href = (actionOf('launch') as HTMLAnchorElement).href;
    const launch = launchTileOf('launch');
    await show('launch');
    await step('press-launch');
    await wait(100);
    await step('release');
    // The launch starts with the click, while the press springs back under the turn.
    const started = eventOf('launch', 'tilelaunchstart', mark);
    check('launch: the click starts the launch at once, with the URL of the link', !!started && started.url === href, `url ${started && started.url}`);
    check('launch: the hash does not change at once', location.hash !== '#launched', location.hash);
    const t0 = started ? started.at : performance.now();
    const box = launch.getBoundingClientRect();
    // The turn is under way at 10%: ease-in, so it is still well short of 90 degrees.
    await until(() => performance.now() - t0 >= 0.1 * LAUNCH, 2000);
    const early = launch.debugState.motion ? launch.debugState.motion.rotateY : undefined;
    check('launch: the tile is turning from the start (rotateY between 1 and 45 at 10%)', early !== undefined && early > 1 && early < 45, `rotateY ${early}`);
    // At 20% it has grown and moved toward the middle of the screen, as the recording shows.
    await until(() => performance.now() - t0 >= 0.2 * LAUNCH, 2000);
    const m20 = launch.debugState.motion;
    const toward = (d: number, from: number, middle: number) => (middle - from === 0 ? true : Math.sign(d) === Math.sign(middle - from));
    check('launch: at 20% the tile has grown and moves toward the middle of the screen', !!m20 && m20.scale > 1.05 && toward(m20.x, box.left + box.width / 2, innerWidth / 2) && toward(m20.y, box.top + box.height / 2, innerHeight / 2), JSON.stringify(m20));
    await until(() => performance.now() - t0 >= 0.35 * LAUNCH, 2000);
    const rotate = launch.debugState.motion ? launch.debugState.motion.rotateY : undefined;
    check('launch: at 35% the tile is edge-on (rotateY about 90)', rotate !== undefined && Math.abs(rotate - 90) < 3, `rotateY ${rotate}`);
    const splashes = splashesNow();
    const logo = splashes[0] && splashes[0].querySelector('#splash-mark');
    check('launch: at 35% the splash is in the body, in the color of the tile, with a copy of the logo', splashes.length === 1 && getComputedStyle(splashes[0]).backgroundColor === 'rgb(0, 120, 215)' && !!logo && logo.textContent === 'Logo', `splashes ${splashes.length}`);
    // It goes on from the line of the tile: taller than the tile, not yet the screen.
    const s35 = splashes[0] ? splashes[0].offsetHeight : 0;
    check('launch: at 35% the splash is between the tile and the screen in size', s35 > box.height * 1.2 && s35 < innerHeight - 1, `height ${s35}`);
    const followed = await until(() => location.hash === '#launched', 2000);
    check('launch: the link is followed about one duration after the start', followed >= 0 && Math.abs(followed - t0 - LAUNCH) <= 120, `after ${(followed - t0).toFixed(0)} ms`);
    await until(() => !!eventOf('launch', 'tilelaunchend', mark), 4000);
    const activate = eventOf('launch', 'tilelaunchactivate', mark);
    const end = eventOf('launch', 'tilelaunchend', mark);
    check('launch: tilelaunchactivate fires while the splash covers the page', !!activate && activate.splashes === 1, `splashes ${activate && activate.splashes}`);
    const r = activate && activate.splash;
    check('launch: the splash covers the screen at the activation', !!r && Math.abs(r.left) < 1 && Math.abs(r.top) < 1 && Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 1, r ? `${r.left},${r.top} ${r.width}x${r.height}` : 'none');
    check('launch: the splash stays its least time, then goes after its fade, and the tile turns back', !!end && end.splashes === 0 && end.motion === null && !!activate && end.at - activate.at >= SPLASH_MIN + 140, `after ${end && activate ? (end.at - activate.at).toFixed(0) : '?'} ms`);
    check('launch: a hash link keeps no other hold', !!activate && !!end && end.at - activate.at < SPLASH_MIN + 400, `after ${end && activate ? (end.at - activate.at).toFixed(0) : '?'} ms`);
    check('launch: tilelaunchend says done, with the URL of the link', !!end && end.reason === 'done' && end.url === href, `reason ${end && end.reason}`);

    // 2. The splash waits for a held promise: here 400 ms after the activation.
    holdOn['launch-hold'] = () => new Promise((r) => setTimeout(r, 400));
    const mark2 = await launchOnce('launch-hold');
    delete holdOn['launch-hold'];
    const a2 = eventOf('launch-hold', 'tilelaunchactivate', mark2);
    const e2 = eventOf('launch-hold', 'tilelaunchend', mark2);
    check('hold: the splash stays until the held promise settles', !!a2 && !!e2 && e2.at - a2.at >= 480 && e2.at - a2.at <= 900, `after ${a2 && e2 ? (e2.at - a2.at).toFixed(0) : '?'} ms`);

    // 2b. A held promise that never settles ends with --ax-tile-splash-timeout (200 ms here).
    holdOn['launch-timeout'] = () => new Promise(() => undefined);
    const mark3 = await launchOnce('launch-timeout');
    delete holdOn['launch-timeout'];
    const a3 = eventOf('launch-timeout', 'tilelaunchactivate', mark3);
    const e3 = eventOf('launch-timeout', 'tilelaunchend', mark3);
    check('hold: the timeout ends the hold after --ax-tile-splash-timeout', !!a3 && !!e3 && e3.reason === 'done' && e3.at - a3.at >= 300 && e3.at - a3.at <= 500, `after ${a3 && e3 ? (e3.at - a3.at).toFixed(0) : '?'} ms`);

    // 2c. `none`: no timeout. The splash waits for the held promise however long it takes.
    {
        let release: () => void = () => undefined;
        holdOn['launch-forever'] = () => new Promise<void>((r) => (release = r));
        resetHash();
        const mark = launchEvents.length;
        await show('launch-forever');
        await step('press-launch-forever');
        await wait(100);
        await step('release');
        await until(() => !!eventOf('launch-forever', 'tilelaunchactivate', mark), 4000);
        await wait(6000);
        check('timeout none: the splash still waits after the 5 s default', splashesNow().length === 1 && !eventOf('launch-forever', 'tilelaunchend', mark), `splashes ${splashesNow().length}`);
        release();
        await until(() => !!eventOf('launch-forever', 'tilelaunchend', mark), 2000);
        delete holdOn['launch-forever'];
        check('timeout none: the splash goes once the promise settles', !!eventOf('launch-forever', 'tilelaunchend', mark) && splashesNow().length === 0, `splashes ${splashesNow().length}`);
    }

    // 2d. A time past the longest browser timer is cut to it, not fired at once.
    holdOn['launch-huge'] = () => new Promise((r) => setTimeout(r, 400));
    const markHuge = await launchOnce('launch-huge');
    delete holdOn['launch-huge'];
    const aHuge = eventOf('launch-huge', 'tilelaunchactivate', markHuge);
    const eHuge = eventOf('launch-huge', 'tilelaunchend', markHuge);
    check('timeout 3000000s: the splash waits for the promise, not for nothing', !!aHuge && !!eHuge && eHuge.at - aHuge.at >= 400, `after ${aHuge && eHuge ? (eHuge.at - aHuge.at).toFixed(0) : '?'} ms`);

    // 3. A canceled tilelaunchstart: no launch, the click is activated after the ripple as before.
    resetHash();
    const mark4 = launchEvents.length;
    await show('launch-cancel');
    await step('press-launch-cancel');
    await wait(100);
    await step('release');
    await wait(30);
    check('canceled: no splash and no turn', splashesNow().length === 0 && launchTileOf('launch-cancel').debugState.motion === null && location.hash !== '#launch-cancel-target', `hash ${location.hash}`);
    await until(() => location.hash === '#launch-cancel-target', 4000);
    check('canceled: the link is followed after the ripple, without the flip', location.hash === '#launch-cancel-target' && !eventOf('launch-cancel', 'tilelaunchactivate', mark4) && !eventOf('launch-cancel', 'tilelaunchend', mark4), `hash ${location.hash}`);

    // 3b. launch() with a canceled start: the action runs at once, with no turn, and the promise resolves after it.
    resetHash();
    const mark8 = launchEvents.length;
    const canceledTile = launchTileOf('launch-cancel');
    const called = performance.now();
    await canceledTile.launch();
    // Firefox applies a fragment navigation a moment after the click: the hash must follow within 300 ms.
    const changed = await until(() => location.hash === '#launch-cancel-target', 300);
    check('launch(): a canceled start runs the action at once, with no turn and no splash', changed >= 0 && !!eventOf('launch-cancel', 'tilelaunchstart', mark8) && !eventOf('launch-cancel', 'tilelaunchactivate', mark8) && canceledTile.debugState.motion === null && splashesNow().length === 0, `hash ${location.hash} after ${(changed - called).toFixed(0)} ms`);

    // 4. Default prefetch: once per URL, and not when preventPrefetch() is called.
    await launchOnce('launch');
    check('prefetch: the link is prefetched once, however often it is launched', prefetchesOf(href) === 1, `prefetches ${prefetchesOf(href)}`);
    const nopfHref = (actionOf('launch-nopf') as HTMLAnchorElement).href;
    await launchOnce('launch-nopf');
    check('prefetch: preventPrefetch() suppresses it', prefetchesOf(nopfHref) === 0, `prefetches ${prefetchesOf(nopfHref)}`);

    // 9. bfcache: a page restored while the splash is held takes it down and ends the launch.
    holdOn['launch-restore'] = () => new Promise(() => undefined);
    resetHash();
    const mark5 = launchEvents.length;
    await show('launch-restore');
    await step('press-launch-restore');
    await wait(100);
    await step('release');
    await until(() => !!eventOf('launch-restore', 'tilelaunchactivate', mark5), 2000);
    await wait(200);
    const heldAt = splashesNow().length;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const e5 = eventOf('launch-restore', 'tilelaunchend', mark5);
    delete holdOn['launch-restore'];
    check('bfcache: a restored page takes the held splash down and ends the launch', heldAt === 1 && splashesNow().length === 0 && launchTileOf('launch-restore').debugState.motion === null && !!e5 && e5.reason === 'restore', `held ${heldAt}, reason ${e5 && e5.reason}`);

    // 6. A tile without --ax-tile-launch: no events, no splash, and the click waits for the ripple as before.
    resetHash();
    const mark6 = launchEvents.length;
    await step('press-normal-tile');
    await wait(60);
    await step('release');
    await until(() => location.hash === '#normal-target', 4000);
    check('normal tile: no launch events and no splash', launchEvents.slice(mark6).length === 0 && splashesNow().length === 0 && location.hash === '#normal-target', `events ${launchEvents.slice(mark6).length}`);

    // 7. tile.launch(ready) on a button: the events, the click at the end of the flip, the promise after the splash.
    resetHash();
    const mark7 = launchEvents.length;
    const clicks0 = buttonClicks;
    const btnTile = launchTileOf('launch-button');
    const ready = new Promise((r) => setTimeout(r, 700));
    const callAt = performance.now();
    let resolvedAt = 0;
    const running = btnTile.launch(ready);
    const second = btnTile.launch().then(() => 'resolved', () => 'rejected');
    let resolved = false;
    let splashAtResolve = -1;
    running.then(() => {
        resolved = true;
        resolvedAt = performance.now();
        splashAtResolve = splashesNow().length;
    });
    await until(() => resolved, 4000);
    const s7 = eventOf('launch-button', 'tilelaunchstart', mark7);
    const a7 = eventOf('launch-button', 'tilelaunchactivate', mark7);
    const e7 = eventOf('launch-button', 'tilelaunchend', mark7);
    check('launch(): the events fire, and the button runs once, at the end of the flip', !!s7 && !!a7 && !!e7 && a7.clicks - clicks0 === 0 && e7.clicks - clicks0 === 1 && buttonClicks - clicks0 === 1, `clicks ${buttonClicks - clicks0}`);
    check('launch(): the promise resolves once the splash is gone, and waits for ready', resolved && splashAtResolve === 0 && resolvedAt - callAt >= 680, `splashes ${splashAtResolve}, after ${(resolvedAt - callAt).toFixed(0)} ms`);
    check('launch(): a second launch of a running tile rejects', (await second) === 'rejected', '');
    const noAction = await launchTileOf('static').launch().then(() => 'resolved', () => 'rejected');
    check('launch(): a tile without an action rejects', noAction === 'rejected', noAction);
    resetHash();
}

// A modifier click on a launch tile passes at once, as any click of the gate (real keys: Playwright only).
async function launchKeyChecks() {
    resetHash();
    const mark = launchEvents.length;
    await show('launch-modifiers');
    await step('click:launch-modifiers:0:Control');
    await wait(100);
    check('modifier click: passes at once, no launch and no splash', !eventOf('launch-modifiers', 'tilelaunchstart', mark) && splashesNow().length === 0, `events ${launchEvents.length - mark}`);
}

// Reduced motion: no turn; the splash covers the page at once, and the click follows on the next frame.
async function reducedLaunchChecks() {
    resetHash();
    const tile = launchTileOf('launch') as any;
    let turned = false;
    const motion = tile.motion.bind(tile);
    tile.motion = (state: { rotateY?: number } | null) => {
        if (state && state.rotateY) turned = true;
        motion(state);
    };
    // The splash is read on the frame after the start: the driver's ack comes later than the activation.
    let snap: { n: number; rect: DOMRect | null } | null = null;
    const onStart = (e: Event) => {
        if ((e.target as Element).id !== 'launch') return;
        requestAnimationFrame(() => {
            const s = splashesNow();
            snap = { n: s.length, rect: s[0] ? s[0].getBoundingClientRect() : null };
        });
    };
    document.addEventListener('tilelaunchstart', onStart);
    const mark = launchEvents.length;
    await show('launch');
    await step('press-launch');
    await wait(100);
    await step('release');
    await until(() => snap !== null, 1000);
    document.removeEventListener('tilelaunchstart', onStart);
    const shot = snap as { n: number; rect: DOMRect | null } | null;
    const r = shot && shot.rect;
    check('reduced: the splash covers the viewport on the next frame', !!shot && shot.n === 1 && !!r && r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight, `splashes ${shot && shot.n}`);
    check('reduced: the tile does not turn', !turned, '');
    await until(() => !!eventOf('launch', 'tilelaunchend', mark), 4000);
    delete tile.motion;
    const a = eventOf('launch', 'tilelaunchactivate', mark);
    const e = eventOf('launch', 'tilelaunchend', mark);
    check('reduced: the link is followed, and the splash goes after its least time, without a fade', location.hash === '#launched' && !!a && !!e && e.at - a.at >= SPLASH_MIN - 20 && e.at - a.at < SPLASH_MIN + 100 && e.reason === 'done' && e.splashes === 0, `after ${a && e ? (e.at - a.at).toFixed(0) : '?'} ms`);
}

// A launch from a router-like listener, a transparent tile and the keyboard.
async function launchMoreChecks() {
    // A router takes the replayed click (prevents it): the page keeps its frame, and the splash goes on
    // the next frame, with no hold.
    const mark = await launchOnce('launch-router');
    const rA = eventOf('launch-router', 'tilelaunchactivate', mark);
    const rE = eventOf('launch-router', 'tilelaunchend', mark);
    check('router: a prevented click gives no navigation hold; the splash goes after its fade', location.pathname === '/' && !!rA && !!rE && rE.at - rA.at < SPLASH_MIN + 400 && rE.reason === 'done', `path ${location.pathname}, after ${rA && rE ? (rE.at - rA.at).toFixed(0) : '?'} ms`);

    // A tile with no fill: the splash is black, not transparent.
    resetHash();
    const mark2 = launchEvents.length;
    await show('launch-dark');
    await step('press-launch-dark');
    await wait(100);
    await step('release');
    await until(() => !!eventOf('launch-dark', 'tilelaunchstart', mark2), 2000);
    const started = eventOf('launch-dark', 'tilelaunchstart', mark2);
    const t0 = started ? started.at : performance.now();
    await until(() => performance.now() - t0 >= 0.35 * LAUNCH, 2000);
    const dark = splashesNow()[0];
    check('splash color: a transparent color gives a black splash', !!dark && getComputedStyle(dark).backgroundColor === 'rgb(0, 0, 0)', dark ? getComputedStyle(dark).backgroundColor : 'no splash');
    await until(() => !!eventOf('launch-dark', 'tilelaunchend', mark2), 4000);
}

// The keyboard: Enter on the action of a flip tile runs the launch as a click does.
async function launchKeyboardChecks() {
    resetHash();
    const mark = launchEvents.length;
    const href = (actionOf('launch') as HTMLAnchorElement).href;
    const launch = launchTileOf('launch');
    await show('launch');
    actionOf('launch').focus();
    await step('down:Enter');
    const started = eventOf('launch', 'tilelaunchstart', mark);
    check('keyboard: Enter starts the launch with the URL of the link', !!started && started.url === href, `url ${started && started.url}`);
    const t0 = started ? started.at : performance.now();
    // The front half is 30% of the duration; halfway through it the tile has turned part of the way.
    await until(() => performance.now() - t0 >= 0.15 * LAUNCH, 1000);
    const mid = launch.debugState.motion ? launch.debugState.motion.rotateY : undefined;
    check('keyboard: the tile is turning midway through the turn', mid !== undefined && mid > 5 && mid < 85, `rotateY ${mid}`);
    await step('up:Enter');
    const followed = await until(() => location.hash === '#launched', 2000);
    check('keyboard: the link is followed about one duration after the start', followed >= 0 && Math.abs(followed - t0 - LAUNCH) <= 120, `after ${(followed - t0).toFixed(0)} ms`);
    await until(() => !!eventOf('launch', 'tilelaunchend', mark), 4000);
    const end = eventOf('launch', 'tilelaunchend', mark);
    check('keyboard: the launch ends as a click launch does', !!end && end.reason === 'done' && end.splashes === 0, `reason ${end && end.reason}`);
    resetHash();
}

async function run() {
    registerRevealLayer();
    register();
    await wait(50);
    // The navigation checks (run.ts) load this page with ?navigate: they drive it from outside.
    if (new URLSearchParams(location.search).has('navigate')) {
        // A beacon of the splash every 50 ms: it still goes out while the page is navigating away.
        setInterval(() => navigator.sendBeacon(`/beacon?n=${splashesNow().length}&p=${encodeURIComponent(location.pathname)}`), 50);
        return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await reducedChecks();
        await reducedLaunchChecks();
    } else {
        await pointerChecks();
        await overlayChecks();
        await launchChecks();
        await launchMoreChecks();
        if (realKeys) {
            await launchKeyChecks();
            await launchKeyboardChecks();
            await keyChecks();
        }
    }
    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
