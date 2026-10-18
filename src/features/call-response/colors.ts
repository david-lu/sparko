export type HSVColor = { hue: number; saturation: number; value: number };
/** Missing value denotes the original HSL color with fixed 80% lightness. */
export type AnswerColor = { hue: number; saturation: number; value?: number };
type RGB = [number, number, number];
const defaults = ['#ffe49a', '#daccff', '#aff0df', '#ffcbb4'];
export const clampColor = (n: number, max = 100) => Math.max(0, Math.min(max, n));

export function hsvToRgb({ hue, saturation, value }: HSVColor): RGB {
  const h = ((hue % 360) + 360) % 360 / 60, s = saturation / 100, v = value / 100;
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  const channels = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return channels.map(channel => Math.round((channel + m) * 255)) as RGB;
}
export const rgbToHex = (rgb: RGB) => `#${rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
export const hsvToHex = (color: HSVColor) => rgbToHex(hsvToRgb(color));

export function hexToHsv(hex: string, achromaticHue = 0): HSVColor | null {
  if (!/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return null;
  let digits = hex.replace('#', '');
  if (digits.length === 3) digits = [...digits].map(digit => digit + digit).join('');
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const sector = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: delta ? (sector * 60 + 360) % 360 : achromaticHue, saturation: max ? delta / max * 100 : 0, value: max * 100 };
}

export function answerColor(answer: { color?: AnswerColor }, index: number): HSVColor {
  if (!answer.color) return hexToHsv(defaults[index % defaults.length])!;
  const { hue, saturation, value } = answer.color;
  if (value !== undefined) return { hue, saturation, value };
  // Convert legacy HSL, preserving its actual RGB color instead of reinterpreting it as HSV.
  const v = .8 + saturation / 100 * .2;
  return { hue, saturation: 200 * (1 - .8 / v), value: v * 100 };
}

function luminance(rgb: RGB) {
  const [r, g, b] = rgb.map(channel => {
    const s = channel / 255;
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
const mix = (rgb: RGB, target: number, amount: number): RGB => rgb.map(channel => Math.round(channel + (target - channel) * amount)) as RGB;

/** Flat face keeps the selected color exact; surrounding facets supply the depth. */
export function choicePalette(color: HSVColor) {
  const rgb = hsvToRgb(color), lightness = luminance(rgb);
  const dark: RGB = [17, 20, 27];
  const darkContrast = (lightness + .05) / (luminance(dark) + .05), whiteContrast = 1.05 / (lightness + .05);
  const text = darkContrast >= 4.5 ? rgbToHex(dark) : whiteContrast >= 4.5 ? '#ffffff' : '#000000';
  return {
    '--choice-fill': rgbToHex(rgb), '--choice-text': text,
    '--choice-highlight': rgbToHex(mix(rgb, 255, .38)),
    '--choice-edge': rgbToHex(mix(rgb, 255, .12)),
    '--choice-bevel': rgbToHex(mix(rgb, 0, .16)),
    '--choice-shadow': rgbToHex(mix(rgb, 0, .32)),
  };
}
export const answerColorStyle = (answer: { color?: AnswerColor }, index: number) => choicePalette(answerColor(answer, index));
