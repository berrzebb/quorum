/**
 * Planner mode determination — pure function deciding interactive vs auto.
 *
 * NO file I/O, NO provider execution.
 */

export interface PlannerModeOpts {
  /** User passed --auto flag */
  isAuto: boolean;
  /** Running in mux mode (--mux) */
  isMux: boolean;
  /** CPS content is available (non-empty) */
  hasCPS: boolean;
  /** stdin is a TTY (interactive terminal) */
  isTTY: boolean;
}

/**
 * Determine whether the planner should run in auto or interactive mode.
 *
 * Auto mode is selected when:
 * - User explicitly requests it (--auto), OR
 * - Not in mux mode AND CPS is available AND stdin is not a TTY
 */
export function determinePlannerMode(opts: PlannerModeOpts): "interactive" | "auto" {
  if (opts.isAuto) return "auto";
  if (!opts.isMux && opts.hasCPS && !opts.isTTY) return "auto";
  return "interactive";
}
