import { describe, expect, it } from 'vitest';
import { gridStep, type CellBox } from './gridNav';

/** Two full rows of 3, then a short row of 2 (cells 40 wide, 40 tall, 4 apart). */
const boxes: CellBox[] = [];
for (let i = 0; i < 8; i++) boxes.push({ x: (i % 3) * 44, y: Math.floor(i / 3) * 44, w: 40, h: 40 });

describe('gridStep', () => {
  it('moves left and right in reading order and stops at the ends', () => {
    expect(gridStep(boxes, 1, 'ArrowRight')).toBe(2);
    expect(gridStep(boxes, 2, 'ArrowRight')).toBe(3);
    expect(gridStep(boxes, 1, 'ArrowLeft')).toBe(0);
    expect(gridStep(boxes, 0, 'ArrowLeft')).toBeNull();
    expect(gridStep(boxes, 7, 'ArrowRight')).toBeNull();
  });
  it('moves up and down to the cell in the same column', () => {
    expect(gridStep(boxes, 1, 'ArrowDown')).toBe(4);
    expect(gridStep(boxes, 4, 'ArrowUp')).toBe(1);
    expect(gridStep(boxes, 7, 'ArrowUp')).toBe(4);
  });
  it('goes to the nearest cell when the next row is shorter, and nowhere past the first or last row', () => {
    expect(gridStep(boxes, 5, 'ArrowDown')).toBe(7);
    expect(gridStep(boxes, 2, 'ArrowUp')).toBeNull();
    expect(gridStep(boxes, 7, 'ArrowDown')).toBeNull();
  });
  it('jumps with Home and End, and ignores other keys', () => {
    expect(gridStep(boxes, 4, 'Home')).toBe(0);
    expect(gridStep(boxes, 4, 'End')).toBe(7);
    expect(gridStep(boxes, 4, 'a')).toBeNull();
    expect(gridStep([], 0, 'ArrowRight')).toBeNull();
  });
});
