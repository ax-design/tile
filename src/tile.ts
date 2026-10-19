// <ax-tile>: a surface with one action, the link or button in its light DOM with slot="action". The
// action covers the tile and tilts with its content, so the press is felt before the action runs
// (see gate.ts). Content goes in the default slot and needs nothing.
import { AxSurface } from '@ax-design/surface';
import type { Values } from '@ax-design/surface';
import { TILE_BRAND, inNestedTile, installGate, isDisabled, markKeyboardPress } from './gate.js';
import { isLaunching, replay, startLaunch } from './launch.js';

// A surface inside a tile, read by its methods: it may come from another copy of surface.
interface PressableSurface extends Element {
    press(at?: { x: number; y: number } | 'center'): void;
    release(): void;
}

// Defaults of a tile, as :host rules: every style of the page wins over them.
// The action is the tile name: it covers the tile, sits above the content and lays its text out at
// the bottom left, as on Windows. Plain properties only: Safari 12 has no inset.
// The name stays in the accessibility tree with label="hidden": font-size 0 hides it, where
// color: transparent would be undone by forced colors. It is !important: a ::slotted rule loses to
// any style the page gives the action, and hiding the name is what the attribute asks for.
// Without focus-ring="native" the focus layer draws the ring around the shape, not the browser outline;
// !important, so a page-wide :focus-visible outline does not draw a second ring.
const STYLE = `
:host { --ax-border-width: 2px; }
::slotted([slot="action"]) {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
  display: flex; align-items: flex-end; box-sizing: border-box; margin: 0; padding: 0 8px 6px;
  border: 0; border-radius: 0; background: none; font: inherit; color: inherit;
  text-decoration: none; text-align: start; cursor: pointer;
}
:host([label="hidden"]) ::slotted([slot="action"]) { font-size: 0 !important; line-height: 0 !important; }
:host(:not([focus-ring="native"])) ::slotted([slot="action"]) { outline: none !important; }
`;

// The tilt type of the surface, read from its method (its package is not a dependency of this one).
type TiltOf = ReturnType<AxSurface['tiltParams']>;

export class AxTile extends AxSurface {
    static readonly ElementName: string = 'ax-tile';
    static schemaKey = 'ax-tile';

    // Keys that started a keyboard press and have not been released yet ('' for none).
    private keyHeld = '';
    // Surfaces inside the tile that share its current press (see pressInner).
    private pressedInner: PressableSurface[] = [];

    // Launches the tile from code, as a click on a tile with --ax-tile-launch: flip does: the events,
    // the flip and the activation of the action (see launch.ts). It runs whatever the tile's
    // --ax-tile-launch says, as calling it is the opt-in. `ready` holds the splash until it settles.
    // The promise resolves when the splash is gone; a canceled tilelaunchstart resolves it at once,
    // with nothing launched.
    launch(ready?: Promise<unknown>): Promise<void> {
        const action = this.actionElement();
        if (!action || isDisabled(action)) return Promise.reject(new Error('<ax-tile>.launch(): the tile has no enabled action'));
        if (isLaunching(this)) return Promise.reject(new Error('<ax-tile>.launch(): a launch of this tile is running'));
        return startLaunch(this, action, () => replay(null, action, this), ready || null) || Promise.resolve();
    }

    constructor() {
        super();
        const root = this.shadowRoot!;
        const style = document.createElement('style');
        style.textContent = STYLE;
        root.insertBefore(style, root.firstChild);
        // After the default slot, so the action is above the content and tilts with it.
        const slot = document.createElement('slot');
        slot.name = 'action';
        root.querySelector('.content')!.appendChild(slot);
        this.addEventListener('pointerdown', this.onTilePointerDown);
        this.addEventListener('keydown', this.onKeyDown);
        this.addEventListener('keyup', this.onKeyUp);
        this.addEventListener('focusout', this.onFocusOut);
    }

    // A brand rather than instanceof: several copies of this package may be on the page.
    get [TILE_BRAND as unknown as string](): boolean {
        return true;
    }

    static get observedAttributes() {
        return AxSurface.observedAttributes.concat(['focus-ring']);
    }

    connectedCallback() {
        installGate();
        super.connectedCallback();
    }

    attributeChangedCallback(name: string) {
        // The layers depend on focus-ring. Asking the surface to rebuild them as a change of `layers`
        // does is the one public way to do it.
        if (name === 'focus-ring') super.attributeChangedCallback('layers');
        else super.attributeChangedCallback(name);
    }

    // The focus layer is on unless focus-ring="native" asks for the browser outline.
    protected layerNames_(): string[] {
        const names = super.layerNames_();
        if (this.getAttribute('focus-ring') !== 'native' && names.indexOf('focus') < 0) names.push('focus');
        return names;
    }

    // A static tile (no action) has no press feedback: no pointer for the layers, no tilt.
    protected pointerAllowed(): boolean {
        return !!this.actionElement();
    }

    protected tiltParams(values: Values, width: number, height: number, x: number, y: number): TiltOf {
        return this.actionElement() ? super.tiltParams(values, width, height, x, y) : null;
    }

    // Ends the press of the tile and of the surfaces inside it that share it. tile-group calls this
    // when a drag takes the gesture over.
    release(): void {
        super.release();
        this.releaseInner();
    }

    // Surfaces inside a tile share its press: the action covers them, so the pointer never reaches
    // them, yet their light is part of the tile (a reveal surface over a picture). They are pressed
    // where the tile is, or at their center for the keyboard. Nested tiles have presses of their own.
    private pressInner(clientX: number | null, clientY: number | null) {
        this.releaseInner();
        const all = this.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const surface = all[i] as PressableSurface;
            if (typeof surface.press !== 'function' || typeof surface.release !== 'function' || inNestedTile(surface, this)) continue;
            if (clientX === null || clientY === null) surface.press();
            else {
                const r = surface.getBoundingClientRect();
                surface.press({ x: clientX - r.left, y: clientY - r.top });
            }
            this.pressedInner.push(surface);
        }
    }

    private releaseInner() {
        const pressed = this.pressedInner;
        this.pressedInner = [];
        for (const surface of pressed) surface.release();
    }

    private onTilePointerDown = (event: PointerEvent) => {
        const action = this.actionElement();
        if (!action || event.button !== 0 || isDisabled(action) || event.composedPath().indexOf(action) < 0) return;
        this.pressInner(event.clientX, event.clientY);
        if (!this.pressedInner.length) return;
        const end = () => {
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            this.releaseInner();
        };
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    };

    // The first child with slot="action".
    private actionElement(): Element | null {
        for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
            if (child.getAttribute('slot') === 'action') return child;
        }
        return null;
    }

    // The keyboard presses the action as a pointer does. Enter presses links and buttons; Space presses
    // buttons only, as a link scrolls the page with it. Auto-repeat and modified keys do nothing.
    private onKeyDown = (event: KeyboardEvent) => {
        const action = this.actionElement();
        if (!action || event.composedPath().indexOf(action) < 0) return;
        if (event.repeat || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || isDisabled(action)) return;
        const space = event.key === ' ' || event.key === 'Spacebar';
        if (event.key !== 'Enter' && !(space && action.localName === 'button')) return;
        this.keyHeld = event.key;
        markKeyboardPress(this);
        this.press();
        this.pressInner(null, null);
    };

    private onKeyUp = (event: KeyboardEvent) => {
        if (this.keyHeld && event.key === this.keyHeld) {
            this.keyHeld = '';
            this.release();
        }
    };

    // Focus leaving the action ends a key press that is still held: its keyup will not come here.
    private onFocusOut = (event: FocusEvent) => {
        const action = this.actionElement();
        if (this.keyHeld && action && event.composedPath().indexOf(action) >= 0) {
            this.keyHeld = '';
            this.release();
        }
    };
}
