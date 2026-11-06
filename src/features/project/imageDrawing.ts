export type DrawingPoint = { x: number; y: number };
export type DrawingStroke = { tool: 'brush' | 'eraser'; color: string; size: number; points: DrawingPoint[] };

/** Erase only marks on the transparent drawing layer, leaving the source image intact. */
export function paintDrawing(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, strokes: DrawingStroke[]) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.save();
    context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.lineWidth = stroke.size; context.lineCap = context.lineJoin = 'round';
    context.strokeStyle = context.fillStyle = stroke.color;
    const [first, ...rest] = stroke.points;
    context.beginPath(); context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2); context.fill();
    if (rest.length) {
      context.beginPath(); context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }
}
