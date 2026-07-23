import {
  TIMELINE_BOUNDS,
  getVisibleDatedAdditionCount,
} from '@/lib/layout';
import { useTwinStore } from '@/lib/store';

const TOTAL_DATED_ADDITIONS = getVisibleDatedAdditionCount(
  TIMELINE_BOUNDS.maxYear,
);

export function TimelineControl() {
  const activeTimelineYear = useTwinStore((state) => state.activeTimelineYear);
  const setActiveTimelineYear = useTwinStore(
    (state) => state.setActiveTimelineYear,
  );
  const visibleDatedAdditions = getVisibleDatedAdditionCount(activeTimelineYear);

  return (
    <section
      className='timeline-panel hud-panel pointer-events-auto absolute bottom-4 left-1/2 z-20 w-72 -translate-x-1/2 px-3 py-2 font-mono'
      aria-labelledby='timeline-year-label'
    >
      <div className='flex items-end justify-between gap-3'>
        <div>
          <div className='text-muted-foreground text-[9px] tracking-[0.18em] uppercase'>
            Construction timeline
          </div>
          <output
            id='timeline-year-label'
            className='text-foreground block text-xl leading-none tabular-nums'
            htmlFor='timeline-year'
          >
            {activeTimelineYear}
          </output>
        </div>
        <div className='text-muted-foreground text-right text-[9px] leading-tight tracking-[0.08em] uppercase'>
          <span className='text-foreground block tabular-nums'>
            {visibleDatedAdditions}/{TOTAL_DATED_ADDITIONS}
          </span>
          dated additions
        </div>
      </div>
      <label className='sr-only' htmlFor='timeline-year'>
        Active construction timeline year
      </label>
      <input
        id='timeline-year'
        type='range'
        min={TIMELINE_BOUNDS.minYear}
        max={TIMELINE_BOUNDS.maxYear}
        step={1}
        value={activeTimelineYear}
        aria-valuetext={`${activeTimelineYear}; ${visibleDatedAdditions} of ${TOTAL_DATED_ADDITIONS} dated additions visible`}
        onChange={(event) => setActiveTimelineYear(Number(event.target.value))}
        className='mt-2 h-4 w-full cursor-ew-resize touch-pan-x accent-primary'
      />
      <div className='text-muted-foreground flex justify-between text-[8px] tabular-nums'>
        <span>{TIMELINE_BOUNDS.minYear}</span>
        <span>{TIMELINE_BOUNDS.maxYear}</span>
      </div>
    </section>
  );
}
