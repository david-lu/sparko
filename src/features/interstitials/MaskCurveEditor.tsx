import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DiamondPlus, RotateCcw, Undo2, Redo2, X } from 'lucide-react';
import { defaultMaskCurve, maskStrength, type MaskCurve, type MaskPoint, type MaskSide as ReferenceMaskSide } from '../../../shared/mask-curves';
import type { InterstitialSettings } from '../../../shared/interstitials';
import type { maskVideoBoundaries } from './mask-video-boundaries';
import { useExclusiveMenu, useMenuScrollDismiss } from '../../shared/DropdownMenu';
import './mask-curves.css';
import { h3MaskGroups } from '../../../shared/generation-inputs';

export type MaskChannel = 'video' | 'audio';
type Channel = MaskChannel;
type MaskSide = ReferenceMaskSide | 'body';
type EditableCurve = MaskCurve & { body: MaskPoint[] };
export type MaskCurves = Record<Channel, MaskCurve>;
type Curves = Record<Channel, EditableCurve>;
const editable = (values: MaskCurves): Curves => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { ...value, body: value.body ?? [{ position: 0, strength: 1 }, { position: 1, strength: 1 }] }])) as Curves;
type Selection = { side: MaskSide; index: number };
type KeyframeContext = { x:number; y:number; time:number; strength:number; selection:Selection|null; target:SVGElement };
type Props = { before: number; after: number; duration: number;
  allowBody?: boolean;
  imageKeyframes?: { id: string; name: string; time: number }[];
  videoMs: number; audioMs: number; onChange: (patch: Partial<InterstitialSettings>) => void };
const title = (channel: Channel) => channel === 'video' ? 'Video' : 'Audio';
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timecode = (time: number) => {
  const frames = Math.round(time * 24);
  return `${String(Math.floor(frames / 24)).padStart(2, '0')}:${String(frames % 24).padStart(2, '0')}`;
};

function curvePath(curve: MaskCurve, before: number, duration: number, after: number, from: number, to: number,
  x: (time: number) => number, y: (strength: number) => number, samples = 320) {
  return Array.from({length:samples+1}, (_,i) => {
    const time = from+(to-from)*i/samples;
    return `${i?'L':'M'}${x(time).toFixed(2)},${y(maskStrength(curve,time,before,duration,after)).toFixed(2)}`;
  }).join(' ');
}

function VideoBoundaries({boundaries,from,to,x,top,bottom}: {
  boundaries:ReturnType<typeof maskVideoBoundaries>; from:number; to:number; x:(time:number)=>number; top:number; bottom:number;
}) {
  return boundaries.filter(({time})=>time>=from&&time<=to).map(({side,time})=><g key={`${side}:${time}`} className="mask-video-boundary"
    role="img" aria-label={`${side==='start'?'Start':'End'} video boundary at ${time.toFixed(3)} seconds`}>
    <title>{side==='start'?'Start':'End'} reference clip boundary · {time.toFixed(3)} s</title>
    <line x1={x(time)} x2={x(time)} y1={top} y2={bottom}/>
    <path d={`M${x(time)-3},${top-5}h6l-3,5Z`}/>
  </g>);
}

function ImageKeyframeMarkers({ values = [], from, to, x, top, bottom }: {
  values: Props['imageKeyframes']; from: number; to: number; x: (time: number) => number; top: number; bottom: number;
}) {
  return values.filter(value => value.time >= from && value.time <= to).map(value => <g key={value.id} className="mask-image-keyframe" role="img" aria-label={`Image guide ${value.name} at ${value.time.toFixed(3)} seconds`}>
    <title>Image guide: {value.name} · {value.time.toFixed(3)}s</title>
    <line x1={x(value.time)} x2={x(value.time)} y1={top} y2={bottom}/>
    <path d={`M${x(value.time)},${top}l4,4 -4,4 -4,-4Z`}/>
  </g>);
}

export function MaskCurvePanel({ before, after, duration, imageKeyframes, videoMs, audioMs, initial, boundaries, active, onChange, onClose, headingId, onPreview, allowBody = false }: Props & {
  initial: MaskCurves; boundaries: ReturnType<typeof maskVideoBoundaries>; active: Channel; onClose: () => void; headingId?: string;
  onPreview?: (value: MaskCurves) => void;
}) {
  const id=useId(), graph=useRef<SVGSVGElement>(null), container=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(720), [draft,setDraft]=useState(() => editable(initial)), [selection,setSelection]=useState<Selection|null>(null);
  const [cursor,setCursor]=useState(before?before/2:before+duration+after/2), [view,setView]=useState<'all'|MaskSide>('all');
  const [past,setPast]=useState<Curves[]>([]), [future,setFuture]=useState<Curves[]>([]);
  const [context,setContext]=useState<KeyframeContext|null>(null);
  const drag=useRef<{selection:Selection; channel:Channel; handle?:'in'|'out'; initial:Curves; moved:boolean}|null>(null);
  useLayoutEffect(()=>{
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(230,entry.contentRect.width)));
    observer.observe(container.current!); return ()=>observer.disconnect();
  },[]);
  useEffect(() => { onPreview?.(draft); }, [draft, onPreview]);
  const total=before+duration+after, height=290, left=38, right=width-18, top=37, bottom=height-31;
  const from=view==='end'?before+duration:0, to=view==='start'?before:total, span=to-from;
  const x=(time:number)=>left+(time-from)/span*(right-left), y=(strength:number)=>bottom-strength*(bottom-top);
  const offset=(side:MaskSide)=>side==='start'?0:side==='body'?before:before+duration;
  const length=(side:MaskSide)=>side==='start'?before:side==='body'?duration:after;
  const sides:MaskSide[]=allowBody?['start','body','end']:['start','end'];
  const seconds=(side:MaskSide,p:MaskPoint)=>offset(side)+p.position*length(side);
  const region=(time:number):MaskSide|null=>before>0&&time<before?'start':after>0&&time>before+duration?'end':allowBody?'body':null;
  const curve=draft[active], point=selection&&curve[selection.side][selection.index];
  const boundary=!!selection&&selection.side!=='body'&&(selection.side==='start'?selection.index===curve.start.length-1:selection.index===0);
  const endpoint=!!selection&&(selection.index===0||selection.index===curve[selection.side].length-1);
  const change=(next:Curves)=>{if(same(next,draft))return;setPast(p=>[...p,draft].slice(-50));setFuture([]);setDraft(next);};
  const reset=()=>{change(editable({...draft,[active]:defaultMaskCurve(before,after,active==='video'?videoMs:audioMs)}));setSelection(null);};
  const undo=()=>{if(!past.length)return;setFuture(p=>[draft,...p]);setDraft(past.at(-1)!);setPast(p=>p.slice(0,-1));setSelection(null);};
  const redo=()=>{if(!future.length)return;setPast(p=>[...p,draft]);setDraft(future[0]);setFuture(p=>p.slice(1));setSelection(null);};
  const coordinates=(event:{clientX:number;clientY:number})=>{
    const box=graph.current!.getBoundingClientRect();
    return {time:clamp(from+((event.clientX-box.left)/box.width*width-left)/(right-left)*span,from,to),
      strength:clamp((bottom-(event.clientY-box.top)/box.height*height)/(bottom-top))};
  };
  const movedPoint=(channel:Channel,selected:Selection,time:number,strength:number,handle?:'in'|'out')=>{
    const c=draft[channel], points=c[selected.side], p=points[selected.index];
    const spanLength=length(selected.side), start=offset(selected.side);
    const position=(time-start)/spanLength, first=selected.index===0, last=selected.index===points.length-1;
    const fixed=selected.side!=='body'&&(selected.side==='start'?last:first);
    let next:MaskPoint;
    if(handle){
      const neighbor=points[selected.index+(handle==='in'?-1:1)];
      if(!neighbor)return draft;
      next={...p,[handle]:{influence:clamp((position-p.position)/(neighbor.position-p.position)),strength:clamp(strength)}};
    } else {
      const strengthDelta=(fixed?1:clamp(strength))-p.strength;
      next={...p,position:first||last?p.position:clamp(position,points[selected.index-1].position+.00001,points[selected.index+1].position-.00001),strength:fixed?1:clamp(strength),
        ...(p.in?{in:{...p.in,strength:clamp(p.in.strength+strengthDelta)}}:{}),...(p.out?{out:{...p.out,strength:clamp(p.out.strength+strengthDelta)}}:{})};
    }
    return {...draft,[channel]:{...c,interpolation:handle?'bezier':c.interpolation,[selected.side]:points.map((value,index)=>index===selected.index?next:value)}};
  };
  const add=(time=cursor,strength?:number)=>{
    const side=region(time);if(!side)return;
    const position=(time-offset(side))/length(side),points=curve[side];
    const near=points.findIndex(p=>Math.abs(p.position-position)<.005);
    if(near>=0){setSelection({side,index:near});return;}
    if(points.length>=16)return;
    const next=[...points,{position,strength:strength??maskStrength(curve,time,before,duration,after)}].sort((a,b)=>a.position-b.position);
    change({...draft,[active]:{...curve,[side]:next}});setSelection({side,index:next.findIndex(p=>p.position===position)});setCursor(time);
  };
  const removable=(selected:Selection|null)=>!!selected&&selected.index>0&&selected.index<curve[selected.side].length-1;
  const remove=(selected=selection)=>{if(!selected||!removable(selected))return;change({...draft,[active]:{...curve,[selected.side]:curve[selected.side].filter((_,i)=>i!==selected.index)}});setSelection(null);};
  const startDrag=(event:ReactPointerEvent<SVGElement>,selected:Selection,handle?:'in'|'out')=>{
    if(event.button===2){event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});return;}
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();
    setSelection(selected);setCursor(seconds(selected.side,curve[selected.side][selected.index]));
    drag.current={selection:selected,channel:active,handle,initial:draft,moved:false};graph.current!.setPointerCapture(event.pointerId);
  };
  const endDrag=(cancel=false)=>{
    const current=drag.current;drag.current=null;if(!current?.moved)return;
    if(cancel)setDraft(current.initial);else{setPast(p=>[...p,current.initial].slice(-50));setFuture([]);}
  };
  const apply=()=>{
    onChange({[`${active}MaskCurve`]:same(draft[active],defaultMaskCurve(before,after,active==='video'?videoMs:audioMs))?undefined:draft[active]});onClose();
  };
  const handlePosition=(side:MaskSide,index:number,direction:'in'|'out')=>{
    const points=curve[side],p=points[index],neighbor=points[index+(direction==='in'?-1:1)];if(!neighbor)return;
    const handle=curve.interpolation==='bezier'?p[direction]:undefined;
    return {time:seconds(side,{position:p.position+(neighbor.position-p.position)*(handle?.influence??1/3),strength:0}),strength:handle?.strength??p.strength};
  };
  const openContext=(event:ReactMouseEvent<SVGElement>|ReactKeyboardEvent<SVGElement>,selected:Selection|null=null)=>{
    if('key' in event&&event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    event.preventDefault();event.stopPropagation();if(drag.current)return;
    const p=selected?{time:seconds(selected.side,curve[selected.side][selected.index]),strength:curve[selected.side][selected.index].strength}
      :'key' in event?{time:clamp(cursor,from,to),strength:maskStrength(curve,clamp(cursor,from,to),before,duration,after)}:coordinates(event);
    const box=graph.current!.getBoundingClientRect();
    setSelection(selected);setCursor(p.time);
    setContext({...p,selection:selected,target:event.currentTarget,
      x:'key' in event?box.left+x(p.time)/width*box.width:event.clientX,
      y:'key' in event?box.top+y(p.strength)/height*box.height:event.clientY});
  };
  const contextSide=context&&region(context.time);
  return <>
    <div className="mask-graph-editor" onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape' && (context || drag.current)){event.preventDefault();context?setContext(null):endDrag(true);}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
    }}>
      <header className="mask-editor-header"><div><span className="eyebrow">GENERATION · VALUE GRAPH</span><h2 id={headingId ?? id}>{title(active)} mask editor</h2></div>
        <button type="button" className="icon-button" aria-label="Cancel mask edits" onClick={onClose}><X size={17}/></button></header>
      <div className="mask-editor-toolbar">
        <div className="mask-editor-history"><button type="button" className="icon-button" aria-label="Undo mask edit" disabled={!past.length} onClick={undo}><Undo2 size={15}/></button><button type="button" className="icon-button" aria-label="Redo mask edit" disabled={!future.length} onClick={redo}><Redo2 size={15}/></button></div>
        <button type="button" className="mask-add-key" onClick={()=>add()} disabled={!region(cursor)||curve[region(cursor)!]?.length>=16}><DiamondPlus size={14}/>Add keyframe</button>
        <span className="mask-editor-time" aria-label="Mask cursor time">{timecode(cursor)} <small>24 fps</small></span>
        <div className="mask-editor-views" role="group" aria-label="Graph view">{(['all','start','end'] as const).map(value=><button type="button" key={value} aria-pressed={view===value} disabled={value==='start'?!before:value==='end'?!after:false} onClick={()=>setView(value)}>{value==='all'?'Fit':value==='start'?'Start':'End'}</button>)}</div>
      </div>
      <div className="mask-editor-workspace">
        <div className="mask-editor-graph" ref={container}>
          <svg ref={graph} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Mask value graph" tabIndex={0}
            onContextMenu={event=>openContext(event)} onKeyDown={event=>openContext(event)}
            onPointerDown={event=>{
              if(event.button===2){event.preventDefault();event.currentTarget.focus({preventScroll:true});}
              if(event.button===0)setCursor(Math.round(coordinates(event).time*24)/24);
            }}
            onDoubleClick={event=>{const p=coordinates(event);add(p.time,p.strength);}}
            onPointerMove={event=>{const current=drag.current;if(!current)return;const p=coordinates(event);current.moved=true;setDraft(movedPoint(current.channel,current.selection,p.time,p.strength,current.handle));setCursor(p.time);}}
            onPointerUp={()=>endDrag()} onPointerCancel={()=>endDrag(true)}>
            <defs><clipPath id={`${id}-clip`}><rect x={left-8} y={top-10} width={right-left+16} height={bottom-top+20}/></clipPath></defs>
            <rect className="mask-plot-background" x={left} y={top} width={right-left} height={bottom-top}/>
            <g clipPath={`url(#${id}-clip)`}>
              <rect className="mask-generated-region" x={x(before)} y={top} width={x(before+duration)-x(before)} height={bottom-top}/>
              {active === 'video' && h3MaskGroups(Math.round(total * 24)).filter(group => group.start / 24 >= from && group.start / 24 <= to).map(group => <line key={group.start} className="mask-frame-group" x1={x(group.start / 24)} x2={x(group.start / 24)} y1={top} y2={bottom}><title>Mask cell: frames {group.start}–{group.end - 1}</title></line>)}
              {[0,.25,.5,.75,1].map(value=><line key={value} className="mask-grid-line" x1={left} x2={right} y1={y(value)} y2={y(value)}/>)}
              {Array.from({length:9},(_,i)=><line key={i} className="mask-grid-line" x1={x(from+span*i/8)} x2={x(from+span*i/8)} y1={top} y2={bottom}/>)}
              {[...(before?[before]:[]),...(after?[before+duration]:[])].map(time=><line key={time} className="mask-reference-boundary" x1={x(time)} x2={x(time)} y1={top} y2={bottom}/>)}
              <VideoBoundaries boundaries={boundaries} from={from} to={to} x={x} top={top} bottom={bottom}/>
              <ImageKeyframeMarkers values={imageKeyframes} from={from} to={to} x={x} top={top} bottom={bottom}/>
              {sides.map(side=>{
                const lo=Math.max(from,offset(side)),hi=Math.min(to,offset(side)+length(side));
                return hi>lo?<path key={side} className="mask-curve-hit" d={curvePath(curve,before,duration,after,lo,hi,x,y)}
                  onClick={event=>{event.stopPropagation();add(coordinates(event).time);}}/>:null;
              })}
              <path className="mask-curve-line" d={curvePath(curve,before,duration,after,from,to,x,y)}/>
              {sides.filter(side=>length(side)).flatMap(side=>curve[side].map((p,index)=>{
                const time=seconds(side,p);if(time<from||time>to)return null;
                const chosen=selection?.side===side&&selection.index===index;
                const label=`${title(active)} ${side} keyframe ${index+1}`;
                return <g key={`${side}:${index}`} className="mask-keyframe" data-selected={chosen}>
                  {chosen&&curve.interpolation!=='linear'&&(['in','out'] as const).map(direction=>{
                    const handle=handlePosition(side,index,direction);if(!handle)return null;
                    return <g key={direction}>
                      <line className="mask-tangent" x1={x(time)} y1={y(p.strength)} x2={x(handle.time)} y2={y(handle.strength)}/>
                      <circle className="mask-tangent-hit" cx={x(handle.time)} cy={y(handle.strength)} r={9} role="button" tabIndex={0} aria-label={`${label} ${direction} handle`}
                        onDoubleClick={e=>e.stopPropagation()} onPointerDown={e=>startDrag(e,{side,index},direction)}
                        onContextMenu={event=>openContext(event,{side,index})}
                        onKeyDown={event=>{openContext(event,{side,index});const step=event.shiftKey ? .1 : .01;let t=handle.time,s=handle.strength;
                          if(event.key==='ArrowLeft')t-=span*step;if(event.key==='ArrowRight')t+=span*step;if(event.key==='ArrowUp')s+=step;if(event.key==='ArrowDown')s-=step;
                          if(event.key.startsWith('Arrow')){event.preventDefault();change(movedPoint(active,{side,index},t,s,direction));}}}/>
                      <circle className="mask-tangent-dot" cx={x(handle.time)} cy={y(handle.strength)} r={3}/>
                    </g>;
                  })}
                  <rect className="mask-keyframe-hit" x={x(time)-10} y={y(p.strength)-10} width={20} height={20} role="button" tabIndex={0} aria-label={label}
                    aria-pressed={chosen} onFocus={()=>setSelection({side,index})} onDoubleClick={e=>e.stopPropagation()} onPointerDown={e=>startDrag(e,{side,index})}
                    onContextMenu={event=>openContext(event,{side,index})}
                    onKeyDown={event=>{
                      openContext(event,{side,index});
                      const step=event.shiftKey?10:1;let t=time,s=p.strength;
                      if(event.key==='ArrowLeft')t-=step/24;if(event.key==='ArrowRight')t+=step/24;if(event.key==='ArrowUp')s+=step/100;if(event.key==='ArrowDown')s-=step/100;
                      if(event.key.startsWith('Arrow')){event.preventDefault();change(movedPoint(active,{side,index},t,s));}
                      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
                    }}><title>{time.toFixed(3)} s · {Math.round(p.strength*100)}% regeneration</title></rect>
                  <path className="mask-keyframe-diamond" d={`M${x(time)},${y(p.strength)-4}l4,4 -4,4 -4,-4Z`}/>
                </g>;
              }))}
            </g>
            {[0,.25,.5,.75,1].map(value=><text key={value} className="mask-axis-label" x={left-7} y={y(value)+3} textAnchor="end">{value*100}</text>)}
            {Array.from({length:5},(_,i)=><text key={i} className="mask-axis-label" x={x(from+span*i/4)} y={height-9} textAnchor={i===0?'start':i===4?'end':'middle'}>{(from+span*i/4).toFixed(2)}s</text>)}
            {([[0,before,'START'],[before,before+duration,'GENERATE'],[before+duration,total,'END']] as const).map(([a,b,label])=>{
              const lo=Math.max(a,from),hi=Math.min(b,to);return hi>lo&&x(hi)-x(lo)>35?<text key={label} className="mask-region-label" x={(x(lo)+x(hi))/2} y={20} textAnchor="middle">{label}</text>:null;
            })}
          </svg>
        </div>
      </div>
      <div className="mask-keyframe-properties">
        <div className="mask-selection-label"><span>SELECTED KEYFRAME</span><strong>{selection?`${selection.side==='start'?'Start':selection.side==='body'?'Input':'End'} · Keyframe ${selection.index+1}`:'Click a diamond'}</strong></div>
        <label>Time <span><input aria-label="Keyframe time" type="number" step={1/24} disabled={!point||endpoint} value={point?Number(seconds(selection!.side,point).toFixed(3)):''}
          onChange={event=>{if(point&&Number.isFinite(event.target.valueAsNumber))change(movedPoint(active,selection!,event.target.valueAsNumber,point.strength));}}/>s</span></label>
        <label>Regenerate <span><input aria-label="Keyframe regeneration" type="number" min={0} max={100} step={1} disabled={!point||boundary} value={point?Number((point.strength*100).toFixed(1)):''}
          onChange={event=>{if(point&&Number.isFinite(event.target.valueAsNumber))change(movedPoint(active,selection!,seconds(selection!.side,point),event.target.valueAsNumber/100));}}/>%</span></label>
        <button type="button" className="mask-delete-key" disabled={!selection||endpoint} onClick={()=>remove()}>Delete keyframe</button>
      </div>
      <div className="mask-curve-options"><label>Interpolation<select aria-label="Mask curve interpolation" value={curve.interpolation} onChange={event=>change({...draft,[active]:{...curve,interpolation:event.target.value as MaskCurve['interpolation']}})}>
        <option value="linear">Linear</option><option value="smooth">Easy ease</option><option value="bezier">Bézier</option></select></label>
        <button type="button" onClick={reset}><RotateCcw size={12}/>Reset {active}</button></div>
      <p className="mask-editor-help">0% keeps the input; 100% regenerates it. Click to add a point. Empty regions always generate.</p>
      <footer className="mask-editor-footer"><span>Applies to the next generation.</span><button type="button" className="button" onClick={onClose}>Cancel</button><button type="button" className="button primary" onClick={apply}>Apply {active} mask</button></footer>
    </div>
    {context&&<KeyframeMenu x={context.x} y={context.y} onClose={()=>setContext(null)} restoreFocus={()=>context.target.focus({preventScroll:true})}
      canAdd={!context.selection&&!!contextSide&&curve[contextSide].length<16} canDelete={removable(context.selection)}
      onAdd={()=>{add(context.time,context.strength);setContext(null);graph.current?.focus({preventScroll:true});}}
      onDelete={()=>{remove(context.selection);setContext(null);graph.current?.focus({preventScroll:true});}}/>}
  </>;
}

function KeyframeMenu({x,y,onClose,restoreFocus,canAdd,canDelete,onAdd,onDelete}: {
  x:number; y:number; onClose:()=>void; restoreFocus:()=>void; canAdd:boolean; canDelete:boolean; onAdd:()=>void; onDelete:()=>void;
}) {
  const element=useRef<HTMLDivElement>(null);
  useExclusiveMenu(element,true,onClose,restoreFocus);
  useMenuScrollDismiss(element,onClose);
  useLayoutEffect(()=>{
    const menu=element.current!;menu.showPopover();const box=menu.getBoundingClientRect();
    menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-box.width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-box.height-8))}px`;
    (menu.querySelector<HTMLButtonElement>('button:not(:disabled)')??menu).focus({preventScroll:true});
  },[x,y]);
  return <div ref={element} popover="manual" className="mask-keyframe-menu" role="menu" aria-label="Mask keyframe actions" tabIndex={-1} style={{left:x,top:y}}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}
    onKeyDown={event=>{
      event.stopPropagation();if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
      const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
    }}>
    <button type="button" role="menuitem" disabled={!canAdd} onClick={onAdd}>Add keyframe</button>
    <button type="button" role="menuitem" disabled={!canDelete} onClick={onDelete}>Delete keyframe</button>
  </div>;
}
