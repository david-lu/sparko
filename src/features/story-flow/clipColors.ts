/** Clip labels are independent of media type and playback behavior. */
export const clipColors = {
  gray: '#a8a49b', blue: '#5ba8ed', purple: '#b08aeb',
  green: '#57bd99', amber: '#e0ad50', rose: '#e57d9b',
} as const;
export type ClipColor = keyof typeof clipColors;
export const clipColorName = (color: ClipColor) => color[0].toUpperCase() + color.slice(1);
