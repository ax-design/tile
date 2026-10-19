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

A press tilts the tile and plays its ripple, and the action runs once that feedback is over. Without the delay, a link would navigate under the finger before the press is seen. The tile holds the click on the page, then sends it on to its target, so the browser still runs the native action: a link navigates, `target="_blank"` opens a window, a submit button submits. Routers and the listeners of your page receive the click as usual.

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

Written for the browsers of Surface: Chrome 70, Firefox 63 and Safari 12. It uses `composedPath`, `new MouseEvent`, `:host()` and `::slotted()`, and ES2017 output, with no `inset`.

## Development

```bash
bun install
bun run build        # es/, build/index.mjs, build/main.js
bun run check        # type check
bun test             # unit tests
bun run test:browser chromium firefox webkit  # browser tests (Playwright)
```
