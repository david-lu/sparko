import { describe, expect, it } from 'vitest';
import { answerColor, answerColorStyle, choicePalette, hexToHsv, hsvToHex } from '../../src/features/call-response/colors';

// Independent contrast measurement on the actual displayed hex colors.
const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(s => s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);

describe('choice colors', () => {
  it('supports exact arbitrary RGB colors, primaries, grays, black and white', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#187ae4', '#d0a57b', '#080b16']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
    expect(hsvToHex({ hue: 210, saturation: 45, value: 80 })).toBe('#709ecc');
    expect(hexToHsv('#abc')).toEqual(hexToHsv('#aabbcc'));
    expect(hexToHsv('#ffffff', 215)?.hue).toBe(215);
    expect(hexToHsv('garbage')).toBeNull();
  });
  it('keeps existing defaults and legacy HSL colors visually unchanged', () => {
    expect(answerColorStyle({}, 0)['--choice-fill']).toBe('#ffe49a');
    expect(answerColorStyle({}, 1)['--choice-fill']).toBe('#daccff');
    expect(answerColorStyle({ color: { hue: 210, saturation: 45 } }, 0)['--choice-fill']).toBe('#b5cce3');
    expect(answerColorStyle({ color: { hue: 0, saturation: 0 } }, 0)['--choice-fill']).toBe('#cccccc');
    expect(answerColor({ color: { hue: 210, saturation: 45, value: 0 } }, 0).value).toBe(0);
  });
  it('keeps text contrast at least 4.5:1 across the full HSV gamut', () => {
    for (let hue = 0; hue <= 360; hue += 10) for (let saturation = 0; saturation <= 100; saturation += 10) {
      for (let value = 0; value <= 100; value += 2) {
        const palette = choicePalette({ hue, saturation, value });
        const face = luminance(palette['--choice-fill']), text = luminance(palette['--choice-text']);
        expect((Math.max(face, text) + .05) / (Math.min(face, text) + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
