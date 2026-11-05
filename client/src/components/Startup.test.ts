import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import StartupError from './StartupError';
import { StartupView, createStartup } from './Startup';

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('start-up', () => {
  it('a failed load shows the error page and builds no page; Retry runs the load again', async () => {
    let up = false;
    const load = vi.fn(() => (up ? Promise.resolve() : Promise.reject(new Error('down'))));
    const page = vi.fn(() => createElement('main', null, 'the chart app'));
    const startup = createStartup(load);
    const seen: string[] = [];
    startup.subscribe(() => seen.push(startup.status()));
    expect(startup.status()).toBe('loading');
    await settle();
    expect(startup.status()).toBe('failed');

    const failed = renderToStaticMarkup(createElement(StartupView, { status: startup.status(), onRetry: startup.retry, page }));
    expect(failed).toContain('The Vost server cannot be reached');
    expect(failed).toContain('Retry');
    expect(page).not.toHaveBeenCalled();

    // the Retry button runs the start-up again
    const button = (StartupError({ onRetry: startup.retry }) as any).props.children.find((c: any) => c?.type === 'button');
    up = true;
    button.props.onClick();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(startup.status()).toBe('ready');
    expect(seen).toEqual(['failed', 'loading', 'ready']);
    expect(renderToStaticMarkup(createElement(StartupView, { status: 'ready', onRetry: startup.retry, page }))).toContain('the chart app');
  });

  it('shows nothing while loading, and Retry does nothing then', async () => {
    const load = vi.fn(() => new Promise<void>(() => {}));
    const startup = createStartup(load);
    expect(renderToStaticMarkup(createElement(StartupView, { status: startup.status(), onRetry: startup.retry, page: () => createElement('main') }))).toBe('');
    startup.retry();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
