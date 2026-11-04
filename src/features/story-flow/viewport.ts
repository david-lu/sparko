import { CLIP_HEIGHT } from './model';
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number; rowScale: number };
export type ClipRowBounds = { left: number; right: number; top: number; topOffset?: number; bottomOffset?: number; rightOverflow?: number };

/** Clip bodies and condition labels keep their screen size while row positions scale. */
export function minimumRowScale(clips: ClipRowBounds[], zoom = 1): number {
  let minimum = 0;
  for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length; j++) {
    const a = clips[i], b = clips[j], distance = Math.abs(a.top - b.top);
    if (!distance || a.left * zoom >= b.right * zoom + (b.rightOverflow ?? 0) || b.left * zoom >= a.right * zoom + (a.rightOverflow ?? 0)) continue;
    const [upper, lower] = a.top < b.top ? [a, b] : [b, a];
    minimum = Math.max(minimum, Math.min(1, ((upper.bottomOffset ?? CLIP_HEIGHT) - (lower.topOffset ?? 0) + 24) / distance));
  }
  return minimum;
}

export const toWorld = (point: Point, camera: Camera): Point => ({ x: (point.x-camera.x)/camera.zoom, y: (point.y-camera.y)/camera.rowScale });
export const toScreen = (point: Point, camera: Camera): Point => ({ x: point.x*camera.zoom+camera.x, y: point.y*camera.rowScale+camera.y });
/** Choose a power-of-two world interval that keeps grid dots 24–48 pixels apart. */
export function gridSpacing(scale:number):number {
  const level=Math.log2(Math.max(Number.EPSILON,scale));
  return 24*2**(level-Math.floor(level));
}
export function zoomAt(camera: Camera, zoom: number, anchor: Point): Camera {
  const next=Math.max(.005,Math.min(8,zoom));
  return { ...camera,zoom:next, x:anchor.x-(anchor.x-camera.x)/camera.zoom*next };
}
export function fitCamera(bounds: {left:number;right:number;top:number;bottom:number}, width:number,height:number,maxZoom=2,groups=false,clips:ClipRowBounds[]=[]): Camera {
  const zoom=Math.max(.005,Math.min(maxZoom,Math.max(1,width-96)/Math.max(1,bounds.right-bounds.left)));
  // Compress empty space, but keep overlapping columns readable at fixed clip
  // height. Large vertical branches remain pannable instead of overlapping.
  // Group headers need 64px above clips, plus a 12px viewport inset. Keep
  // symmetrical space so fitting still centers the clip arrangement.
  const rowScale=Math.max(minimumRowScale(clips,zoom),Math.min(1,Math.max(1,height-CLIP_HEIGHT-(groups?152:64))/Math.max(1,bounds.bottom-bounds.top)));
  return { zoom,rowScale,x:width/2-(bounds.left+bounds.right)/2*zoom,y:(height-CLIP_HEIGHT)/2-(bounds.top+bounds.bottom)/2*rowScale };
}

/** Pixels per second when a dragged clip approaches a viewport edge. */
export function edgeVelocity(point:number,extent:number):number {
  const margin=Math.min(48,extent/4);
  return point<margin?-Math.min(800,(margin-point)*12):point>extent-margin?Math.min(800,(point-extent+margin)*12):0;
}
