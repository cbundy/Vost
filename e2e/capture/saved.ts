import type { ScenarioContext } from './scenario.ts';

type SavedDrawings = { version?: number; sources?: Record<string, unknown[]> } | null;

/** The drawings the app saved on the server for the demo source. */
export async function storedDrawings(ctx: ScenarioContext, source = 'demo:DEMO'): Promise<any[]> {
  const saved = (await ctx.settings.get('drawings.v2')) as SavedDrawings;
  return saved?.sources?.[source] ?? [];
}

/** Every drawing source the app saved on the server. */
export async function storedSources(ctx: ScenarioContext): Promise<Record<string, any[]>> {
  const saved = (await ctx.settings.get('drawings.v2')) as SavedDrawings;
  return (saved?.sources ?? {}) as Record<string, any[]>;
}
