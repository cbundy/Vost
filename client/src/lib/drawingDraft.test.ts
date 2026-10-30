import { describe, expect, it } from 'vitest';
import { DRAG_PX, moveDraft, pressDraft, releaseDraft, secondFinger, startDraft } from './drawingDraft';

const a = (n: number) => ({ time: n, price: n * 10 });
const at = (x: number, y = 0) => ({ x, y });

describe('placing a three-anchor drawing', () => {
  it('click, click, click', () => {
    let d = startDraft('parallelChannel', a(1), at(10));
    expect(d.anchors).toEqual([a(1), a(1)]);
    expect(d.phase).toBe('pressing');
    let step = releaseDraft(d, at(10), 3);
    expect(step.done).toBeNull();
    d = step.draft!;
    expect(d.phase).toBe('waiting');
    d = moveDraft(d, a(2));
    expect(d.anchors).toEqual([a(1), a(2)]);
    step = pressDraft(d, a(2), 3);
    expect(step.done).toBeNull();
    d = step.draft!;
    expect(d.anchors).toEqual([a(1), a(2), a(2)]);
    expect(d.phase).toBe('waiting');
    d = moveDraft(d, a(3));
    expect(d.anchors).toEqual([a(1), a(2), a(3)]);
    step = pressDraft(d, a(3), 3);
    expect(step).toEqual({ draft: null, done: [a(1), a(2), a(3)] });
  });

  it('press-drag-release places the first two, then a click places the third', () => {
    let d = startDraft('parallelChannel', a(1), at(10));
    d = moveDraft(d, a(2));
    let step = releaseDraft(d, at(10 + DRAG_PX + 20), 3);
    expect(step.done).toBeNull();
    d = step.draft!;
    expect(d.anchors).toEqual([a(1), a(2), a(2)]);
    expect(d.phase).toBe('waiting');
    d = moveDraft(d, a(5));
    step = pressDraft(d, a(5), 3);
    expect(step.done).toEqual([a(1), a(2), a(5)]);
  });

  it('a release that moved less than the drag threshold is a click', () => {
    const d = startDraft('t', a(1), at(10));
    expect(releaseDraft(d, at(10 + DRAG_PX - 1), 3).draft?.phase).toBe('waiting');
    expect(releaseDraft(d, at(10 + DRAG_PX), 3).draft?.anchors).toHaveLength(3);
  });

  it('taps place one anchor each', () => {
    let d = startDraft('t', a(1), at(0));
    d = releaseDraft(d, at(0), 3).draft!;
    d = pressDraft(moveDraft(d, a(2)), a(2), 3).draft!;
    expect(pressDraft(moveDraft(d, a(3)), a(3), 3).done).toEqual([a(1), a(2), a(3)]);
  });

  it('a second finger drops a pressing draft and keeps a waiting one', () => {
    const d = startDraft('t', a(1), at(0));
    expect(secondFinger(d)).toBeNull();
    const waiting = releaseDraft(d, at(0), 3).draft!;
    expect(secondFinger(waiting)).toBe(waiting);
  });
});

describe('placing a two-anchor drawing', () => {
  it('finishes on the second click', () => {
    const d = releaseDraft(startDraft('trendLine', a(1), at(0)), at(0), 2).draft!;
    expect(pressDraft(moveDraft(d, a(4)), a(4), 2)).toEqual({ draft: null, done: [a(1), a(4)] });
  });

  it('finishes on a drag', () => {
    const d = moveDraft(startDraft('trendLine', a(1), at(0)), a(4));
    expect(releaseDraft(d, at(50), 2)).toEqual({ draft: null, done: [a(1), a(4)] });
  });
});
