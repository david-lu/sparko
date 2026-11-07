import type { Point } from './viewport';

type Curve = {a:Point;b:Point;c:Point;d:Point};
const sample=(s:Curve,t:number):Point=>({x:(1-t)**3*s.a.x+3*(1-t)**2*t*s.b.x+3*(1-t)*t*t*s.c.x+t**3*s.d.x,
  y:(1-t)**3*s.a.y+3*(1-t)**2*t*s.b.y+3*(1-t)*t*t*s.c.y+t**3*s.d.y});
/** Direct connections, with optional movable points along the wire. */
export function linkGeometry(from:Point,to:Point,points:Point[]=[],self=false) {
  // Only a connection back to the same clip needs a loop to remain visible.
  if(self&&!points.length){
    const curve:Curve={a:from,b:{x:from.x+55,y:from.y-105},c:{x:to.x-55,y:to.y-105},d:to};
    return {path:`M${from.x},${from.y} C${curve.b.x},${curve.b.y} ${curve.c.x},${curve.c.y} ${to.x},${to.y}`,middle:sample(curve,.5),insertionIndex:(_point:Point)=>0};
  }
  const anchors=[from,...points,to],segments=anchors.slice(0,-1).map((a,i)=>({a,d:anchors[i+1]}));
  const path=`M${from.x},${from.y} `+segments.map(s=>`L${s.d.x},${s.d.y}`).join(' ');
  // Put the fade icon on the longest segment, away from reroute handles.
  const longest=segments.reduce((best,s)=>Math.hypot(s.d.x-s.a.x,s.d.y-s.a.y)>Math.hypot(best.d.x-best.a.x,best.d.y-best.a.y)?s:best,segments[0]);
  return {path,middle:{x:(longest.a.x+longest.d.x)/2,y:(longest.a.y+longest.d.y)/2},insertionIndex:(point:Point)=>{
    let index=0,distance=Infinity;
    segments.forEach(({a,d},i)=>{
      const dx=d.x-a.x,dy=d.y-a.y,lengthSquared=dx*dx+dy*dy;
      const t=lengthSquared?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared)):0;
      const dist=Math.hypot(a.x+t*dx-point.x,a.y+t*dy-point.y);
      if(dist<distance){distance=dist;index=i;}
    });
    return index;
  }};
}
