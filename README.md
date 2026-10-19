# @ax-design/tile

Web component that implements the tiles of Axiom Design System: one action per tile, with the press felt before the action runs, as on Windows.

## Installation

```bash
// with npm
npm install @ax-design/tile

// with bun
bun add @ax-design/tile
```

and import it:

```javascript
import { register } from '@ax-design/tile';
register();
```

`register()` also defines `<ax-surface>` from `@ax-design/surface`, which `<ax-tile>` is built on. If you don't use a bundler, load `build/main.js` (it exposes `AxTile`) or import `build/index.mjs`.

## Usage

A tile has one action: the link or the button in its light DOM with `slot="action"`. The action covers the whole tile and its text is the name of the tile, at the bottom left:

```html
<ax-tile layers="fill reveal">
  <a slot="action" href="/mail">Mail</a>
</ax-tile>

<ax-tile layers="fill reveal">
  <button slot="action" type="button">Send</button>
</ax-tile>
```

Anything else goes in the default slot and tilts with the tile. A page of content needs nothing:

```html
<ax-tile layers="fill reveal">
  <img src="weather.png" alt="" style="display: block; width: 100%; height: 100%; object-fit: cover">
  <a slot="action">Weather</a>
</ax-tile>
```

Content that you want to click (a button in the content, for example) must be above the action, so give it a `position` and a `z-index` above 1:

```html
<ax-tile layers="fill reveal">
  <button class="above">Refresh</button>
  <a slot="action" href="/weather">Weather</a>
</ax-tile>
```

```css
.above { position: relative; z-index: 2; }
```

A tile without an action is static: it has no press feedback and no keyboard handling. The action is how a tile says it does something: only a tile with one is pressed. A tile that runs a script instead of following a link takes a button as its action and listens to its click (the click of the button also reaches the tile):

```html
<ax-tile layers="fill reveal">
  <button slot="action" type="button">Shuffle</button>
</ax-tile>
```

```javascript
tile.addEventListener('click', () => shuffle());
```

A click listener on a tile with no action makes no press: the tile can't tell that it has one, and a keyboard or a screen reader could not reach it either. The button gives it focus, Enter and Space, and its role.

### Attributes

* `label="hidden"`: the name is not shown, but it stays the accessible name of the action.
* `focus-ring="native"`: the browser draws the keyboard focus outline of the action. By default the focus layer draws the Windows focus ring around the shape instead.
* `activation="immediate"`: the action runs as soon as it is clicked, with no wait for the press feedback.

## Pressing and activation

A press tilts the tile and plays its ripple, and the action runs once that feedback is over. A tile with `--ax-tile-launch: flip` does not wait for it: it launches its app instead (see Launch). Without the delay, a link would navigate under the finger before the press is seen. The tile holds the click on the page, then sends it on to its target, so the browser still runs the native action: a link navigates, `target="_blank"` opens a window, a submit button submits. Routers and the listeners of your page receive the click as usual.

* A click that is not a plain press passes at once: a click with Ctrl, Meta, Shift or Alt, a click with a button other than the primary one, an action that is `disabled` or has `aria-disabled="true"`, and a tile with `activation="immediate"`.
* A button in the content is not delayed: only the action is.
* A click during the wait does not run the action again.
* A replayed click is marked with `axReplay: true`, so that analytics can skip it.
* A tile without a reveal layer waits for its tilt only, which takes 50 ms. Without any feedback (static tiles, `setAlwaysUseFallback(true)`), the click passes at once.
* `--ax-tile-activation-delay-max` caps the wait. It is a `<time>` in `ms` or `s`; `none`, or nothing, is no cap:

```css
ax-tile.quick {
  --ax-tile-activation-delay-max: 100ms;
}
```

### Surfaces inside a tile

A surface inside the tile, such as a reveal light laid over a picture, shares the press of the tile: the action covers it, so the pointer never reaches it, and the tile presses it where the tile was pressed (at its center for the keyboard) and releases it with the tile. Its ripple counts toward the wait. A nested `<ax-tile>` keeps its own press.

```html
<ax-tile layers="fill">
  <img src="cover.jpg" alt="">
  <ax-surface layers="reveal" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%"></ax-surface>
  <a slot="action" href="/album">Album</a>
</ax-tile>
```

### Keyboard

Enter presses a link or a button, and Space presses a button (Space does not activate a link, which scrolls the page). The press comes from the center of the tile, as a keyboard press does in Windows, and is released on the key up or when the action loses focus. The action then runs after the ripple, as with a mouse.

### Reduced motion

With `prefers-reduced-motion: reduce` the tilt takes its end state at once, but a reveal ripple still plays, as it does on Windows, and the click waits for it.

## Launch

A click on a tile with `--ax-tile-launch: flip` launches its app, as Windows 8 does. The tile turns edge-on; then the splash of the app (its color and its logo) turns to face the viewer while it grows from the tile to the whole page, and stays until the app is ready. The action runs at the end of the flip, not after the press feedback:

```html
<ax-tile class="app" layers="fill reveal">
  <a slot="action" href="/mail">Mail</a>
  <template slot="splash"><img src="mail-logo.svg" alt="" width="96"></template>
</ax-tile>
```

```css
.app {
  --ax-tile-launch: flip;
  --ax-tile-splash-color: #0078d7;
}
```

The launch is opt-in: any other value of `--ax-tile-launch` keeps the delayed activation above. The keyboard launches too: Enter on the action of a flip tile starts the launch, as a click does. The properties are inherited, and read on the tile at each launch:

* `--ax-tile-launch`: `flip` turns the launch on. Default `none`.
* `--ax-tile-launch-duration`: a `<time>`, the length of the launch. Default `450ms`. The tile turns in its first 30%; the splash takes the rest.
* `--ax-tile-launch-easing`: the timing function of the splash, as a CSS timing function (`linear`, `ease`, `cubic-bezier()`...). Default `cubic-bezier(0.1, 0.9, 0.2, 1)`.
* `--ax-tile-splash-color`: the color of the splash. Default: the fill color of the tile (`--ax-fill-color`), or `Canvas` in forced colors. A transparent color gives a black splash, the default of Windows for an app that declares none.
* `--ax-tile-splash-fade`: a `<time>`, the fade of the splash once the app is ready. Default `167ms`.
* `--ax-tile-splash-timeout`: a `<time>`, the longest the splash waits for the promises held (see below). Default `5s`.

The splash shows the content of the `<template slot="splash">` of the tile, centered on the color. It is put on the page, not in the tile, and it covers the page while it is there: it takes the pointer.

### The sequence

1. The tile dispatches `tilelaunchstart`. A listener may cancel it: the tile then falls back to the delayed activation, as if the launch were off.
2. Unless a listener called `preventPrefetch()`, a link to the same origin, with no `download` and no other `target`, is prefetched (`<link rel="prefetch">`), once per URL.
3. For the first 30% of the duration the tile turns about its vertical axis to edge-on.
4. Then the splash appears, edge-on, and turns to face the viewer while it grows from the rectangle of the tile to the page.
5. At the end of the duration the tile dispatches `tilelaunchactivate`, then the click is sent on: the link navigates, or the button runs its click. The click is the one the user made, held until now, and it is marked `axReplay`.
6. The splash stays until every promise passed to `hold()` has settled (or the timeout is over), then it fades out and is removed. The tile turns back, and the tile dispatches `tilelaunchend`. A link that the browser navigates to is the exception: when nothing is held and the page has not prevented the click, the splash stays up while the browser leaves the page, and the timeout ends it if the page has not been replaced by then (a `204` response, a download, a page slower than the timeout).

The three events bubble and cross shadow roots. The `detail` of each has `tile`, `action` (the link or the button with `slot="action"`) and `url` (the `href` of a link, `null` for a button):

* `tilelaunchstart` is cancelable. Its `detail` has `hold(promise)` and `preventPrefetch()`.
* `tilelaunchactivate` has `hold(promise)`. It is not cancelable.
* `tilelaunchend` has `reason`: `done` when the splash has gone, or `restore` (see bfcache below).

`hold(promise)` keeps the splash until the promise settles, so that the page can show the app once it is ready. It may be called from the `tilelaunchstart` or the `tilelaunchactivate` listener. `preventPrefetch()` turns the default prefetch off for that launch.

### From code

`tile.launch(ready?)` runs the same launch as a click does, whatever `--ax-tile-launch` says: calling it is the opt-in. It dispatches the same events, turns the tile and clicks the action at the end of the flip. `ready` is a promise held as `hold()` would hold it. The returned promise resolves when the splash is gone. It rejects, without doing anything, when the tile has no action, when the action is disabled, or when a launch of the tile is already running. A `tilelaunchstart` that is canceled runs the action at once, with no turn and no splash: the click is dispatched on the action, and the promise resolves after it.

```javascript
const ready = fetch('/api/mail/summary').then((r) => r.json());
tile.launch(ready);
```

### Back and forward cache

When a page is restored from the back/forward cache while a launch runs (`pageshow` with `persisted`), the splash is removed at once, the tile turns back, and `tilelaunchend` is dispatched with `reason: 'restore'`. A page that unloads for a full navigation has nothing to do.

### Reduced motion

With `prefers-reduced-motion: reduce` a flip is not played: the splash covers the page at once, the click is sent on the next frame, and the splash goes without a fade. The events are the same.

### Routers

The launch sends the click of the link as a real click, so the router of a page handles it as it handles any link. Each of these routers can hold the splash until the page it leads to is ready. The snippets are sketches of the approach, not tested with those frameworks: check them against the version you use.

SvelteKit (in the root layout, once): preload the page when the launch starts, and hold the splash until the navigation is done.

```javascript
import { afterNavigate, preloadData } from '$app/navigation';

let arrived = null;
afterNavigate(() => arrived && arrived());

document.addEventListener('tilelaunchstart', (event) => {
  const { url, hold } = event.detail;
  if (!url) return;
  hold(new Promise((resolve) => (arrived = resolve)));
  preloadData(url);
});
```

Next.js (App Router, in a client component mounted once): prefetch the route, and hold the splash until the pathname changes.

```javascript
'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function LaunchBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const arrived = useRef(null);

  useEffect(() => {
    const onStart = (event) => {
      if (!event.detail.url) return;
      const { pathname: path, search } = new URL(event.detail.url);
      router.prefetch(path + search);
      event.detail.hold(new Promise((resolve) => (arrived.current = resolve)));
    };
    document.addEventListener('tilelaunchstart', onStart);
    return () => document.removeEventListener('tilelaunchstart', onStart);
  }, [router]);

  useEffect(() => {
    if (arrived.current) arrived.current();
  }, [pathname]);

  return null;
}
```

Vue Router: resolve the route the link leads to, load its lazy components, and hold the splash until the navigation is over.

```javascript
import router from './router';

let arrived = null;
router.afterEach(() => arrived && arrived());

document.addEventListener('tilelaunchstart', (event) => {
  const { url, hold } = event.detail;
  if (!url) return;
  const { pathname, search } = new URL(url);
  const resolved = router.resolve(pathname + search);
  const loads = resolved.matched.map((record) => {
    const component = record.components && record.components.default;
    return typeof component === 'function' ? component() : null;
  });
  hold(Promise.all([new Promise((resolve) => (arrived = resolve)), ...loads]));
});
```

React Router (data routers, `createBrowserRouter`): the loader of a route runs when its navigation starts, so the splash waits for the navigation to finish: hold a promise that resolves when `useNavigation().state` goes back to `idle`. A data router has no public preload of a route, so the navigation starts with the click at the end of the flip.

```javascript
import { useEffect, useRef } from 'react';
import { useNavigation } from 'react-router-dom';

export function LaunchBridge() {
  const { state } = useNavigation();
  const arrived = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    const onActivate = (event) => {
      busy.current = true;
      event.detail.hold(new Promise((resolve) => (arrived.current = resolve)));
    };
    document.addEventListener('tilelaunchactivate', onActivate);
    return () => document.removeEventListener('tilelaunchactivate', onActivate);
  }, []);

  useEffect(() => {
    if (state === 'idle' && busy.current) {
      busy.current = false;
      if (arrived.current) arrived.current();
    }
  }, [state]);

  return null;
}
```

Plain multi-page sites: nothing to do. The default prefetch fetches the page while the tile turns, and the splash stays until the browser leaves the page: the old frame, with the splash on it, is kept until the next page paints. A router that prevents the click, or a hash link, is not a navigation to another document, so its splash goes on the next frame, as above.

## With tile-group

`<ax-tile-group>` from `@ax-design/tile-group` lays tiles out and reads their `columns` and `rows`. The tile itself does not handle them. The group owns the `transform`, `opacity` and `z-index` of the tile while it is dragged. When a drag takes the gesture over, the group calls `release()` on the tile, and the tile then drops the click that ends the drag, so a drag never activates the action.

## Accessibility

The tile sets no roles: the link or the button of the action gives the role and the name. With `label="hidden"` the name is kept (the text is `font-size: 0`, which forced colors leave alone). Keyboard focus shows the focus ring of Surface, or the browser outline with `focus-ring="native"`. Forced colors and `prefers-contrast` follow the rules of Surface (see its README).

## Style Controlling

### --ax-border-width

**Default:** `2px` on a tile, so that the reveal light has a border. It is a `:host` rule, so any style of yours wins.

### --ax-tile-activation-delay-max

**Type:** `<time>`, `none`

**Default:** `none`

**Description:** The longest wait of a delayed activation, in `ms` or `s`. Read from the tile.

## Browser support

Written for the browsers of Surface: Chrome 70, Firefox 63 and Safari 12. It uses `composedPath`, `new MouseEvent`, `:host()` and `::slotted()`, and ES2017 output, with no `inset`. The launch runs on `requestAnimationFrame` and the easing functions of Surface: it needs no Web Animations API.

## Development

```bash
bun install
bun run build        # es/, build/index.mjs, build/main.js
bun run check        # type check
bun test             # unit tests
bun run test:browser chromium firefox webkit  # browser tests (Playwright)
```
