/** Strategy examples offered in the Backtest panel (sources shared with the runtime fixtures). */
import smaCross from './fixtures/strategy-sma-cross.pine?raw';
import stopLimit from './fixtures/strategy-exit.pine?raw';

export const PINE_STRATEGY_EXAMPLES: Array<{ name: string; code: string }> = [
  { name: 'SMA cross', code: smaCross },
  { name: 'Stop and limit', code: stopLimit },
];

export const DEFAULT_PINE_CODE = smaCross;
