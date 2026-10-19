// Builds and runs the tile browser test.
// Usage: bun test-browser/run.ts [chromium|firefox|webkit|safari ...]
// AX_BROWSER_PATH points Playwright at a system build of the browser.
import { join } from 'node:path';

const dir = import.meta.dir;
const dist = join(dir, 'dist');
if (!process.env.SKIP_BUILD) {
    // Sibling packages resolve to their sources through the `source` export condition.
    const result = await Bun.build({ entrypoints: [join(dir, 'page.html')], outdir: dist, conditions: ['source'] });
    if (!result.success) throw new Error(result.logs.join('\n'));
}
// What the navigation checks see: when the next page was requested, and the splash counts that the page
// beacons (a page that is navigating away cannot be read any other way).
const seen = { requests: [] as number[], beacons: [] as { t: number; n: number; path: string }[] };

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        // A page that answers late: the navigation to it takes 1.5 s, and the splash must be up meanwhile.
        if (path === '/beacon') {
            const q = new URL(req.url).searchParams;
            seen.beacons.push({ t: Date.now(), n: Number(q.get('n')), path: q.get('p') || '' });
            return new Response(null, { status: 204 });
        }
        if (path === '/next.html') {
            seen.requests.push(Date.now());
            await Bun.sleep(1500);
            return new Response('<!doctype html><title>Next</title><h1 id="next">Next</h1>', { headers: { 'content-type': 'text/html' } });
        }
        // A link that navigates nowhere.
        if (path === '/nothing') return new Response(null, { status: 204 });
        const file = Bun.file(join(dist, path === '/' ? 'page.html' : path));
        return file.size ? new Response(file) : new Response('', { status: 404 });
    },
});

interface Driver {
    eval<T>(script: string): Promise<T>;
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    // Real keys and clicks with modifiers (Playwright only).
    key?(down: boolean, name: string): Promise<void>;
    click?(x: number, y: number, button: number, modifiers: string[]): Promise<void>;
    // Popups opened since the start (Playwright only).
    popups?(): number;
    // Waits until the page is at a path (Playwright only).
    navigated?(path: string): Promise<void>;
    close(): Promise<void>;
}

async function playwright(name: string, url: string, reduced = false): Promise<Driver> {
    const pw = (await import('playwright')) as any;
    const executablePath = process.env.AX_BROWSER_PATH;
    const browser = await pw[name].launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    let popups = 0;
    page.context().on('page', () => popups++);
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url);
    const button = (n: number) => (n === 1 ? 'middle' : n === 2 ? 'right' : 'left');
    return {
        eval: (script) => page.evaluate(script),
        move: (x, y) => page.mouse.move(x, y),
        down: () => page.mouse.down(),
        up: () => page.mouse.up(),
        key: (down, key) => (down ? page.keyboard.down(key) : page.keyboard.up(key)),
        async click(x, y, n, modifiers) {
            for (const m of modifiers) await page.keyboard.down(m);
            await page.mouse.click(x, y, { button: button(n) as any });
            for (const m of modifiers.slice().reverse()) await page.keyboard.up(m);
        },
        popups: () => popups,
        navigated: (path) => page.waitForURL((u) => u.pathname === path, { timeout: 8000 }),
        close: () => browser.close(),
    };
}

async function safari(url: string): Promise<Driver> {
    const port = 4464;
    const proc = Bun.spawn(['safaridriver', '-p', String(port)]);
    await Bun.sleep(1000);
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const json = (await res.json()) as { value: any };
        if (json.value && json.value.error) throw new Error(json.value.message);
        return json.value;
    };
    const sid = (await call('POST', '/session', { capabilities: {} })).sessionId;
    await call('POST', `/session/${sid}/window/rect`, { width: 700, height: 1000 });
    await call('POST', `/session/${sid}/url`, { url });
    const pointer = (actions: unknown[]) =>
        call('POST', `/session/${sid}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] });
    return {
        eval: (script) => call('POST', `/session/${sid}/execute/sync`, { script: `return (${script})`, args: [] }),
        move: (x, y) => pointer([{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' }]),
        down: () => pointer([{ type: 'pointerDown', button: 0 }]),
        up: () => pointer([{ type: 'pointerUp', button: 0 }]),
        async close() {
            await call('DELETE', `/session/${sid}`);
            proc.kill();
        },
    };
}

async function drive(d: Driver) {
    for (;;) {
        const state = await d.eval<{ result: any; step: string; ack: string }>('({ result: window.__result || null, step: window.__step || "", ack: window.__ack || "" })');
        if (state.result) return state.result;
        if (state.step && state.step !== state.ack) {
            // Steps are 'name#n': the number only makes each one unique.
            const cmd = state.step.replace(/#\d+$/, '');
            // Playwright clicks at viewport coordinates, so the target is scrolled into view first.
            const scrollTo = (id: string) => d.eval(`document.getElementById('${id}').scrollIntoView({ block: 'center' })`);
            const center = (id: string) =>
                d.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            const corner = (id: string) =>
                d.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
            if (cmd.indexOf('pressc-') === 0) {
                // A press at the center of the element (a small element, such as a button in the content).
                await scrollTo(cmd.slice(7));
                const c = await center(cmd.slice(7));
                await d.move(c.x, c.y);
                await d.down();
            } else if (cmd.indexOf('press-') === 0) {
                // (190, 10) inside a 200 x 100 tile, where the action is.
                await scrollTo(cmd.slice(6));
                const r = await corner(cmd.slice(6));
                await d.move(r.x + 190, r.y + 10);
                await d.down();
            } else if (cmd === 'release') {
                await d.up();
            } else if (cmd.indexOf('down:') === 0 && d.key) {
                await d.key(true, cmd.slice(5));
            } else if (cmd.indexOf('up:') === 0 && d.key) {
                await d.key(false, cmd.slice(3));
            } else if (cmd.indexOf('click:') === 0 && d.click) {
                // click:<id>:<button>:<modifiers, comma separated>
                const [, id, button, modifiers] = cmd.split(':');
                await scrollTo(id);
                const c = await center(id);
                await d.click(c.x, c.y, Number(button), modifiers ? modifiers.split(',') : []);
            } else if (cmd === 'popups') {
                await d.eval(`(window.__popups = ${d.popups ? d.popups() : 0})`);
            }
            await d.eval(`(window.__ack = ${JSON.stringify(state.step)})`);
        }
        await Bun.sleep(20);
    }
}

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}

// The splash of a launch across a navigation (Playwright only). A link that navigates nowhere ends its
// splash at the timeout; a link to a slow page keeps the splash up until the page loads.
async function navigation(d: Driver): Promise<Check[]> {
    const checks: Check[] = [];
    const count = `document.querySelectorAll('[aria-hidden="true"]').length`;
    const press = async (id: string) => {
        await d.eval(`document.getElementById('${id}').scrollIntoView({ block: 'center' })`);
        await Bun.sleep(100);
        const c = await d.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await d.move(c.x, c.y);
        await d.down();
        await Bun.sleep(100);
        await d.up();
    };

    // 1. A link that answers 204: no navigation, so the splash goes at its timeout (400 ms on this tile).
    await press('launch-204');
    // 250 ms after the activation, inside the 400 ms timeout of the tile.
    await Bun.sleep(700);
    const during = await d.eval<{ splashes: number; path: string }>(`({ splashes: ${count}, path: location.pathname })`);
    checks.push({ name: 'navigation: the splash is up while the timeout runs', ok: during.splashes === 1 && during.path === '/', detail: JSON.stringify(during) });
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) {
        await Bun.sleep(50);
        gone = (await d.eval<number>(count)) === 0;
    }
    const after = await d.eval<string>('location.pathname');
    checks.push({ name: 'navigation: a navigation that never happens ends the splash at the timeout', ok: gone && after === '/', detail: `gone ${gone}, path ${after}` });

    // 2. A link to another document: the splash stays up while the slow page loads, and then the page is there.
    await press('launch-nav');
    let loaded = true;
    try {
        await d.navigated!('/next.html');
    } catch (e) {
        loaded = false;
    }
    // The navigation request is the last one for the next page (the link prefetch comes before it). The
    // page is replaced when its response arrives, 1.5 s after that request: the beacons in between show
    // the splash over the old page, 300 ms or more after the activation.
    const requested = seen.requests[seen.requests.length - 1] || 0;
    const held = seen.beacons.filter((b) => b.t >= requested + 300 && b.t <= requested + 1200);
    checks.push({ name: 'navigation: the splash stays while the next page is loading', ok: held.length >= 5 && held.every((b) => b.n === 1 && b.path === '/'), detail: `beacons ${held.length}, splashes ${held.map((b) => b.n).join('')}` });
    const text = loaded ? await d.eval<string | null>(`document.getElementById('next') && document.getElementById('next').textContent`) : null;
    checks.push({ name: 'navigation: the next page loads', ok: text === 'Next', detail: `text ${text}` });
    return checks;
}

let failed = 0;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium']) {
    // default: the pointer and key checks; reduced: emulated reduced motion, which the Safari driver cannot do.
    const runs = [
        { mode: 'default', reduced: false },
        { mode: 'reduced', reduced: true },
    ];
    for (const { mode, reduced } of runs) {
        if (reduced && name === 'safari') continue;
        const url = `http://127.0.0.1:${server.port}/`;
        // ?keys: the page makes real key and modifier clicks, which only the Playwright driver can do.
        const d = name === 'safari' ? await safari(url) : await playwright(name, url + '?keys', reduced);
        let result: any;
        try {
            result = await drive(d);
        } finally {
            await d.close();
        }
        if (result.error) {
            console.log(`${name} ${mode}: ERROR ${result.error}`);
            failed++;
            continue;
        }
        const bad = result.checks.filter((c: any) => !c.ok);
        failed += bad.length;
        console.log(`${name} ${mode}: ${result.checks.length - bad.length}/${result.checks.length} passed`);
        for (const c of bad) console.log(`  FAIL ${c.name}: ${c.detail}`);
    }
    if (name !== 'safari') {
        // ?navigate: the page leaves its checks to these, which drive it from here.
        const d = await playwright(name, `http://127.0.0.1:${server.port}/?navigate`);
        let checks: Check[];
        try {
            checks = await navigation(d);
        } finally {
            await d.close();
        }
        const bad = checks.filter((c) => !c.ok);
        failed += bad.length;
        console.log(`${name} navigation: ${checks.length - bad.length}/${checks.length} passed`);
        for (const c of bad) console.log(`  FAIL ${c.name}: ${c.detail}`);
    }
}
server.stop();
process.exit(failed ? 1 : 0);
