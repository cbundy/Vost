import { describe, expect, it } from 'vitest';
import { DRAG_PX, closesOnFirst, endDraft, isOpenEnded, moveDraft, pressDraft, releaseDraft, secondFinger, startDraft, undoPoint, type Draft } from './drawingDraft';

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

describe('placing an open-ended drawing', () => {
  const range = { min: 3, max: 4 };
  /** Press at anchor n (the pointer is on it), release without a drag: the first point. */
  const first = () => releaseDraft(startDraft('polyline', a(1), at(10)), at(10), range).draft!;
  const click = (d: Draft, n: number) => pressDraft(moveDraft(d, a(n)), a(n), range);

  it('knows which specs are open-ended', () => {
    expect(isOpenEnded(range)).toBe(true);
    expect(isOpenEnded(3)).toBe(false);
    expect(isOpenEnded({ min: 2, max: 2 })).toBe(false);
  });

  it('clicks add points without finishing until the max', () => {
    let d = first();
    for (const n of [2, 3]) {
      const step = click(d, n);
      expect(step.done).toBeNull();
      d = step.draft!;
    }
    expect(d.anchors).toEqual([a(1), a(2), a(3), a(3)]);
    expect(click(d, 4)).toEqual({ draft: null, done: [a(1), a(2), a(3), a(4)] });
  });

  it('a press-drag-release places the first two points, then clicks continue', () => {
    const d = moveDraft(startDraft('path', a(1), at(10)), a(2));
    const step = releaseDraft(d, at(10 + DRAG_PX + 20), { min: 2, max: 9 });
    expect(step.draft!.anchors).toEqual([a(1), a(2), a(2)]);
    expect(step.draft!.phase).toBe('waiting');
  });

  it('ending drops the moving anchor', () => {
    let d = click(first(), 2).draft!;
    d = click(d, 3).draft!;
    expect(endDraft(moveDraft(d, a(9)), 3)).toEqual({ draft: null, done: [a(1), a(2), a(3)] });
  });

  it('a double-click leaves no duplicate point: its second press on the same spot adds nothing', () => {
    let d = click(first(), 2).draft!;
    d = click(d, 3).draft!; // first press of the double-click
    const again = click(d, 3); // second press, same spot
    expect(again.done).toBeNull();
    expect(again.draft!.anchors).toEqual([a(1), a(2), a(3), a(3)]);
    expect(endDraft(again.draft!, 3).done).toEqual([a(1), a(2), a(3)]);
  });
  it('a double-click on the last point below the max does not finish it', () => {
    const d = click(click(first(), 2).draft!, 3).draft!; // 3 placed, max 4
    expect(click(d, 3).done).toBeNull();
  });
  it('endDraft also drops a repeated last point', () => {
    const d = { ...first(), anchors: [a(1), a(2), a(2), a(2)] };
    expect(endDraft(d, 2).done).toEqual([a(1), a(2)]);
  });

  it('ending with fewer than min points cancels', () => {
    const d = click(first(), 2).draft!;
    expect(endDraft(d, 3)).toEqual({ draft: null, done: null });
    expect(endDraft(d, 2).done).toEqual([a(1), a(2)]);
  });

  it('Backspace removes the last point and from one point cancels', () => {
    let d = click(click(first(), 2).draft!, 3).draft!;
    d = moveDraft(d, a(7));
    d = undoPoint(d)!;
    expect(d.anchors).toEqual([a(1), a(2), a(7)]);
    d = undoPoint(d)!;
    expect(d.anchors).toEqual([a(1), a(7)]);
    expect(undoPoint(d)).toBeNull();
  });

  it('Backspace leaves a draft that is still pressed alone', () => {
    const d = startDraft('path', a(1), at(10));
    expect(undoPoint(d)).toBe(d);
  });

  it('a press on the first point closes only once min points are placed', () => {
    const d2 = click(first(), 2).draft!;
    expect(closesOnFirst(d2, at(11), at(10), 8, 3)).toBe(false);
    const d3 = click(d2, 3).draft!;
    expect(closesOnFirst(d3, at(11), at(10), 8, 3)).toBe(true);
    expect(closesOnFirst(d3, at(60), at(10), 8, 3)).toBe(false);
    expect(endDraft(d3, 3).done).toEqual([a(1), a(2), a(3)]);
  });

  it('fixed-count drafting is unchanged by the number form', () => {
    expect(pressDraft(first(), a(2), 2).done).toEqual([a(1), a(2)]);
  });
});
