import * as THREE from 'three';
import { SIZE, colOf, index, rowOf } from '../core/board';
import { cellAt } from './goban';

export interface GridInputHandlers {
  /** The intersection under the pointer or keyboard cursor changed (null: none). */
  onHover(cell: number | null): void;
  /** The player picked an intersection. */
  onSelect(cell: number): void;
}

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 450;

/**
 * Turns pointer and keyboard input into intersections on the board. A
 * press that barely moves is a pick; anything larger is left to the orbit
 * controls. Keys: arrows move a cursor, Enter or Space places a stone.
 */
export class GridInput {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private local = new THREE.Vector3();
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private keyCursor = false;
  private hovered: number | null = null;

  constructor(
    private element: HTMLElement,
    private camera: THREE.Camera,
    /** The board's top surface; picks are made in its local frame. */
    private surface: THREE.Object3D,
    private handlers: GridInputHandlers,
  ) {
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get current(): number | null {
    return this.hovered;
  }

  private pick(e: PointerEvent): number | null {
    const rect = this.element.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (!hit) return null;
    this.surface.parent!.worldToLocal(this.local.copy(hit.point));
    return cellAt(this.local.x, this.local.z);
  }

  private setHover(cell: number | null): void {
    if (cell === this.hovered) return;
    this.hovered = cell;
    this.handlers.onHover(cell);
  }

  private onPointerMove = (e: PointerEvent) => {
    // Touch has no hover; a finger moving is orbiting the camera.
    if (e.pointerType === 'touch') return;
    if (this.down && e.buttons) return;
    this.keyCursor = false;
    this.setHover(this.pick(e));
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > TAP_SLOP_PX || performance.now() - down.t > TAP_MAX_MS) return;
    const cell = this.pick(e);
    if (cell === null) return;
    if (e.pointerType !== 'touch') this.setHover(cell);
    this.handlers.onSelect(cell);
  };

  private onPointerLeave = () => {
    if (!this.keyCursor) this.setHover(null);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('input, button, select, textarea, dialog')) return;
    const centre = index(SIZE >> 1, SIZE >> 1);
    const move = (dr: number, dc: number) => {
      const from = this.hovered ?? centre;
      const r = Math.min(SIZE - 1, Math.max(0, rowOf(from) + (this.hovered === null ? 0 : dr)));
      const c = Math.min(SIZE - 1, Math.max(0, colOf(from) + (this.hovered === null ? 0 : dc)));
      this.keyCursor = true;
      this.setHover(index(r, c));
    };
    switch (e.key) {
      case 'ArrowLeft':
        move(0, -1);
        break;
      case 'ArrowRight':
        move(0, 1);
        break;
      case 'ArrowUp':
        move(-1, 0);
        break;
      case 'ArrowDown':
        move(1, 0);
        break;
      case 'Enter':
      case ' ':
        if (this.hovered === null) move(0, 0);
        else this.handlers.onSelect(this.hovered);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
}
