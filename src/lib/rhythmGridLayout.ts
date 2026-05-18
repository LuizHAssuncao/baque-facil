const GRID_BASE_MIN_WIDTH_PX = 720;
const GRID_BORDER_WIDTH_PX = 2;
const STEP_COLUMN_MIN_REM = 2.5;

export function rhythmGridColumns(
  trackColumnMinRem: number,
  trackColumnMaxRem: number,
  stepCount: number,
) {
  return [
    `minmax(${trackColumnMinRem}rem, ${trackColumnMaxRem}rem)`,
    `repeat(${stepCount}, minmax(${STEP_COLUMN_MIN_REM}rem, 1fr))`,
  ].join(" ");
}

export function rhythmGridMinWidth(trackColumnMinRem: number, stepCount: number) {
  const columnMinWidthRem = trackColumnMinRem + stepCount * STEP_COLUMN_MIN_REM;

  return [
    `max(${GRID_BASE_MIN_WIDTH_PX}px,`,
    `calc(${columnMinWidthRem}rem + ${GRID_BORDER_WIDTH_PX}px))`,
  ].join(" ");
}
