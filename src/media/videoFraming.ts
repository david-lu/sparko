export type ExportFrame = { width: number; height: number; fit: 'contain' | 'cover' };

/** Fill small borders from model dimension rounding, with at most 5% cropped away.
 * Larger aspect differences retain the complete image. Timeline source footage uses contain.
 */
export function generatedClipFit(width: number, height: number, targetWidth: number, targetHeight: number): 'contain' | 'cover' {
  if (![width, height, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0)) return 'contain';
  const ratio = (width / height) / (targetWidth / targetHeight);
  return Math.min(ratio, 1 / ratio) >= .95 ? 'cover' : 'contain';
}
