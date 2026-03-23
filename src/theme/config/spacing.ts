/**
 * 4px grid — shared by Tailwind and imperative layout (e.g. Home grid, Reanimated).
 */
export const GRID_UNIT = 4

/** Horizontal padding for most screens (matches legacy useAppPaddings). */
export const SCREEN_PADDING_X = GRID_UNIT * 4

/** Home launcher horizontal inset (wider than standard screen padding). */
export const HOME_GRID_PADDING_X = GRID_UNIT * 6

/** Tailwind theme.extend.spacing keys → px (use as p-screen-x, gap-gutter, etc.). */
export const spacing = {
  'screen-x': SCREEN_PADDING_X,
  'screen-y': GRID_UNIT * 2,
  section: GRID_UNIT * 6,
  gutter: GRID_UNIT * 3,
  'home-x': HOME_GRID_PADDING_X,
} as const

/** Tailwind theme.extend.borderRadius — semantic radii in px. */
export const borderRadius = {
  input: GRID_UNIT * 2,
  card: GRID_UNIT * 3,
  sheet: GRID_UNIT * 4,
} as const
