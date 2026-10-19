// @ax-design/tile: the tiles of Axiom Design System.
import { register as registerSurface } from '@ax-design/surface';
import { AxTile } from './tile.js';

export { AxTile } from './tile.js';

// Defines <ax-tile> and the surface it is built on. Safe to call more than once.
export function register(): void {
    registerSurface();
    if (!customElements.get(AxTile.ElementName)) customElements.define(AxTile.ElementName, AxTile);
}
