/** Clip labels are independent of media type and playback behavior. */
export const clipColors = {
  gray: '#9b978e', blue: '#82a5bd', purple: '#a391c2',
  green: '#80a69a', amber: '#c4a779', rose: '#c58d99',
} as const;
export type ClipColor = keyof typeof clipColors;
export const clipColorName = (color: ClipColor) => color[0].toUpperCase() + color.slice(1);
