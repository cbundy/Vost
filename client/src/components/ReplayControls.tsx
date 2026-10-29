import { useEffect, useState } from 'react';
import { fmtTime } from '../lib/format';
import { REPLAY_SPEEDS, replayAtEnd, replayAtStart } from '../lib/replay';
import { fromZonedInputValue, toZonedInputValue } from '../lib/timeRange';
import { useStore } from '../state/store';
import { PauseIcon, PlayIcon, StepBackIcon, StepForwardIcon } from './Icons';

/** The chart bar's replay part: the start-bar hint while picking, the transport strip while replaying. */
export function ReplayControls() {
  const replay = useStore((s) => s.replay);
  const timeZone = useStore((s) => s.timeZone);
  const candles = useStore((s) => s.candles);
  const [typed, setTyped] = useState('');
  const phase = replay?.phase;
  useEffect(() => setTyped(''), [phase]);
  if (!replay) return null;

  if (replay.phase === 'picking') {
    const startFromInput = () => {
      const t = fromZonedInputValue(typed, timeZone);
      if (t == null) {
        useStore.getState().pushToast('error', 'Enter a valid date and time to start the replay.');
        return;
      }
      useStore.getState().startReplayAt(t);
    };
    return (
      <div className="replay-strip" role="toolbar" aria-label="Replay">
        <span className="replay-hint">Click a bar to start replay</span>
        <button className="ghost" onClick={() => useStore.getState().cancelReplay()}>
          Cancel
        </button>
        <input
          type="datetime-local"
          className="replay-date"
          aria-label="Replay start date and time"
          value={typed}
          min={candles[0] ? toZonedInputValue(candles[0].time, timeZone) : undefined}
          max={candles.length ? toZonedInputValue(candles[candles.length - 1].time, timeZone) : undefined}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') startFromInput();
          }}
        />
        <button className="ghost" disabled={!typed} onClick={startFromInput}>
          Start
        </button>
        <span className="replay-spacer" />
      </div>
    );
  }

  const st = useStore.getState();
  const atStart = replayAtStart(replay);
  const atEnd = replayAtEnd(replay);
  const bar = replay.source[replay.cursor];
  return (
    <div className="replay-strip" role="toolbar" aria-label="Replay">
      <button className="ghost" aria-label="Exit replay" title="Exit replay" onClick={() => st.exitReplay()}>
        Exit
      </button>
      <button className="ghost" aria-label="Select a new start bar" title="Pick a new bar to replay from" onClick={() => st.reselectReplayStart()}>
        Select bar
      </button>
      <button className="ghost icon" aria-label="Step back" title="Step back one bar" disabled={atStart} onClick={() => st.stepReplay(-1)}>
        <StepBackIcon />
      </button>
      <button
        className="ghost icon"
        aria-label={replay.playing ? 'Pause' : 'Play'}
        title={replay.playing ? 'Pause' : 'Play'}
        disabled={atEnd && !replay.playing}
        onClick={() => (replay.playing ? st.pauseReplay() : st.playReplay())}
      >
        {replay.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button className="ghost icon" aria-label="Step forward" title="Step forward one bar" disabled={atEnd} onClick={() => st.stepReplay(1)}>
        <StepForwardIcon />
      </button>
      <select
        className="replay-speed"
        aria-label="Replay speed"
        title="Bars per second"
        value={replay.speed}
        onChange={(e) => st.setReplaySpeed(Number(e.target.value))}
      >
        {REPLAY_SPEEDS.map((v) => (
          <option key={v} value={v}>
            {v}x
          </option>
        ))}
      </select>
      <span className="replay-date-text" title="Replay bar">
        {bar ? fmtTime(bar.time, { timeZone }) : ''}
      </span>
      <span className="replay-spacer" />
    </div>
  );
}
