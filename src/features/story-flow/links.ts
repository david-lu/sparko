import type { Point } from './viewport';

type Curve = {a:Point;b:Point;c:Point;d:Point};
const sample=(s:Curve,t:number):Point=>({x:(1-t)**3*s.a.x+3*(1-t)**2*t*s.b.x+3*(1-t)*t*t*s.c.x+t**3*s.d.x,
  y:(1-t)**3*s.a.y+3*(1-t)**2*t*s.b.y+3*(1-t)*t*t*s.c.y+t**3*s.d.y});
/** Curved connections, with optional movable points along the wire. */
export function linkGeometry(from:Point,to:Point,points:Point[]=[],self=false) {
  // Only a connection back to the same clip needs a loop to remain visible.
  if(self&&!points.length){
    const curve:Curve={a:from,b:{x:from.x+55,y:from.y-105},c:{x:to.x-55,y:to.y-105},d:to};
    return {path:`M${from.x},${from.y} C${curve.b.x},${curve.b.y} ${curve.c.x},${curve.c.y} ${to.x},${to.y}`,middle:sample(curve,.5),insertionIndex:(_point:Point)=>0};
  }
  const anchors=[from,...points,to],curves:Curve[]=anchors.slice(0,-1).map((a,i)=>{
    const d=anchors[i+1],dx=d.x-a.x,bend=Math.sign(dx)*Math.min(180,Math.abs(dx)/2);
    // Keep control points between the endpoints, including backward links, so
    // nearby or overlapping clips never produce oversized loops.
    return {a,b:{x:a.x+bend,y:a.y},c:{x:d.x-bend,y:d.y},d};
  });
  const path=`M${from.x},${from.y} `+curves.map(s=>`C${s.b.x},${s.b.y} ${s.c.x},${s.c.y} ${s.d.x},${s.d.y}`).join(' ');
  // Put the fade icon on the longest segment, away from reroute handles.
  const longest=curves.reduce((best,s)=>Math.hypot(s.d.x-s.a.x,s.d.y-s.a.y)>Math.hypot(best.d.x-best.a.x,best.d.y-best.a.y)?s:best,curves[0]);
  return {path,middle:sample(longest,.5),insertionIndex:(point:Point)=>{
    let index=0,distance=Infinity;
    curves.forEach((curve,i)=>{for(let step=0;step<=40;step++){
      const p=sample(curve,step/40),dist=Math.hypot(p.x-point.x,p.y-point.y);
      if(dist<distance){distance=dist;index=i;}
    }});
    return index;
  }};
}
