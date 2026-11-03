import { useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, DiamondPlus, RotateCcw, Undo2, Redo2, X } from 'lucide-react';
import { defaultMaskCurve, maskStrength, type MaskCurve, type MaskPoint, type MaskSide } from '../../../shared/mask-curves';
import type { InterstitialSettings } from '../../../shared/interstitials';
import ModalBackdrop from '../../shared/ModalBackdrop';
import './mask-curves.css';

type Channel = 'video' | 'audio';
type Curves = Record<Channel, MaskCurve>;
type Selection = { side: MaskSide; index: number };
type Props = { before: number; after: number; duration: number; video?: MaskCurve; audio?: MaskCurve;
  videoMs: number; audioMs: number; onChange: (patch: Partial<InterstitialSettings>) => void };
const channels = ['video', 'audio'] as const;
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

export default function MaskCurveEditor(props: Props) {
  const [open,setOpen] = useState<Channel|null>(null), triggers = useRef<Partial<Record<Channel,HTMLButtonElement|null>>>({});
  const total = props.before+props.duration+props.after;
  const curves = {video:props.video??defaultMaskCurve(props.before,props.after,props.videoMs),audio:props.audio??defaultMaskCurve(props.before,props.after,props.audioMs)};
  return <div className="mask-curve-control">{channels.map(channel=><button key={channel} ref={element=>{triggers.current[channel]=element;}} className="mask-curve-preview" type="button" onClick={()=>setOpen(channel)} aria-label={`Edit ${channel} mask`}>
      <span className="mask-curve-preview-heading"><Activity size={13}/><strong>{title(channel)} mask</strong><span>Edit curve ↗</span></span>
      <svg viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true">
        <rect x={props.before/total*300} y={0} width={props.duration/total*300} height={70} className="mask-generated-region"/>
        {[0,.5,1].map(v=><line key={v} x1={0} x2={300} y1={62-v*54} y2={62-v*54} className="mask-grid-line"/>)}
        <path className="mask-curve-line" d={curvePath(curves[channel],props.before,props.duration,props.after,0,total,t=>t/total*300,v=>62-v*54)}/>
      </svg>
      <span className="mask-curve-legend"><span>0% keep · 100% regenerate</span><span>Time →</span></span>
    </button>)}
    {open&&<CurveDialog {...props} active={open} initial={curves} onClose={()=>setOpen(null)} restoreFocus={()=>triggers.current[open]?.focus({preventScroll:true})}/>}
  </div>;
}

function CurveDialog({before,after,duration,videoMs,audioMs,initial,active,onChange,onClose,restoreFocus}: Props & {
  initial:Curves; active:Channel; onClose:()=>void; restoreFocus:()=>void;
}) {
  const id=useId(), graph=useRef<SVGSVGElement>(null), container=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(720), [draft,setDraft]=useState(initial), [selection,setSelection]=useState<Selection|null>(null);
  const [cursor,setCursor]=useState(before?before/2:before+duration+after/2), [view,setView]=useState<'all'|MaskSide>('all');
  const [past,setPast]=useState<Curves[]>([]), [future,setFuture]=useState<Curves[]>([]);
  const drag=useRef<{selection:Selection; channel:Channel; handle?:'in'|'out'; initial:Curves; moved:boolean}|null>(null);
  useLayoutEffect(()=>{
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(230,entry.contentRect.width)));
    observer.observe(container.current!); return ()=>observer.disconnect();
  },[]);
  const total=before+duration+after, height=290, left=38, right=width-18, top=37, bottom=height-31;
  const from=view==='end'?before+duration:0, to=view==='start'?before:total, span=to-from;
  const x=(time:number)=>left+(time-from)/span*(right-left), y=(strength:number)=>bottom-strength*(bottom-top);
  const seconds=(side:MaskSide,p:MaskPoint)=>(side==='start'?0:before+duration)+p.position*(side==='start'?before:after);
  const region=(time:number):MaskSide|null=>before>0&&time<before?'start':after>0&&time>before+duration?'end':null;
  const curve=draft[active], point=selection&&curve[selection.side][selection.index];
  const boundary=!!selection&&(selection.side==='start'?selection.index===curve.start.length-1:selection.index===0);
  const endpoint=!!selection&&(selection.index===0||selection.index===curve[selection.side].length-1);
  const change=(next:Curves)=>{if(same(next,draft))return;setPast(p=>[...p,draft].slice(-50));setFuture([]);setDraft(next);};
  const reset=()=>{change({...draft,[active]:defaultMaskCurve(before,after,active==='video'?videoMs:audioMs)});setSelection(null);};
  const undo=()=>{if(!past.length)return;setFuture(p=>[draft,...p]);setDraft(past.at(-1)!);setPast(p=>p.slice(0,-1));setSelection(null);};
  const redo=()=>{if(!future.length)return;setPast(p=>[...p,draft]);setDraft(future[0]);setFuture(p=>p.slice(1));setSelection(null);};
  const coordinates=(event:{clientX:number;clientY:number})=>{
    const box=graph.current!.getBoundingClientRect();
    return {time:clamp(from+((event.clientX-box.left)/box.width*width-left)/(right-left)*span,from,to),
      strength:clamp((bottom-(event.clientY-box.top)/box.height*height)/(bottom-top))};
  };
  const movedPoint=(channel:Channel,selected:Selection,time:number,strength:number,handle?:'in'|'out')=>{
    const c=draft[channel], points=c[selected.side], p=points[selected.index];
    const length=selected.side==='start'?before:after, offset=selected.side==='start'?0:before+duration;
    const position=(time-offset)/length, first=selected.index===0, last=selected.index===points.length-1;
    const fixed=selected.side==='start'?last:first;
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
    const position=(time-(side==='start'?0:before+duration))/(side==='start'?before:after),points=curve[side];
    const near=points.findIndex(p=>Math.abs(p.position-position)<.005);
    if(near>=0){setSelection({side,index:near});return;}
    if(points.length>=16)return;
    const next=[...points,{position,strength:strength??maskStrength(curve,time,before,duration,after)}].sort((a,b)=>a.position-b.position);
    change({...draft,[active]:{...curve,[side]:next}});setSelection({side,index:next.findIndex(p=>p.position===position)});setCursor(time);
  };
  const remove=()=>{if(!selection||endpoint)return;change({...draft,[active]:{...curve,[selection.side]:curve[selection.side].filter((_,i)=>i!==selection.index)}});setSelection(null);};
  const startDrag=(event:ReactPointerEvent<SVGElement>,selected:Selection,handle?:'in'|'out')=>{
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
  return <ModalBackdrop labelledBy={id} onCancel={()=>drag.current?endDrag(true):onClose()} restoreFocus={restoreFocus}>
    <div className="mask-graph-editor" onKeyDown={event=>{
      event.stopPropagation();
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
    }}>
      <header className="mask-editor-header"><div><span className="eyebrow">GENERATION · VALUE GRAPH</span><h2 id={id}>{title(active)} mask editor</h2></div>
        <button type="button" className="icon-button" aria-label="Cancel mask edits" onClick={onClose}><X size={17}/></button></header>
      <div className="mask-editor-toolbar">
        <div className="mask-editor-history"><button type="button" className="icon-button" aria-label="Undo mask edit" disabled={!past.length} onClick={undo}><Undo2 size={15}/></button><button type="button" className="icon-button" aria-label="Redo mask edit" disabled={!future.length} onClick={redo}><Redo2 size={15}/></button></div>
        <button type="button" className="mask-add-key" onClick={()=>add()} disabled={!region(cursor)||curve[region(cursor)!]?.length>=16}><DiamondPlus size={14}/>Add keyframe</button>
        <span className="mask-editor-time" aria-label="Mask cursor time">{timecode(cursor)} <small>24 fps</small></span>
        <div className="mask-editor-views" role="group" aria-label="Graph view">{(['all','start','end'] as const).map(value=><button type="button" key={value} aria-pressed={view===value} disabled={value==='start'?!before:value==='end'?!after:false} onClick={()=>setView(value)}>{value==='all'?'Fit':value==='start'?'Start':'End'}</button>)}</div>
      </div>
      <div className="mask-editor-workspace">
        <div className="mask-editor-graph" ref={container}>
          <svg ref={graph} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Mask value graph"
            onPointerDown={event=>{if(event.button===0)setCursor(Math.round(coordinates(event).time*24)/24);}}
            onDoubleClick={event=>{const p=coordinates(event);add(p.time,p.strength);}}
            onPointerMove={event=>{const current=drag.current;if(!current)return;const p=coordinates(event);current.moved=true;setDraft(movedPoint(current.channel,current.selection,p.time,p.strength,current.handle));setCursor(p.time);}}
            onPointerUp={()=>endDrag()} onPointerCancel={()=>endDrag(true)}>
            <defs><clipPath id={`${id}-clip`}><rect x={left-8} y={top-10} width={right-left+16} height={bottom-top+20}/></clipPath></defs>
            <rect className="mask-plot-background" x={left} y={top} width={right-left} height={bottom-top}/>
            <g clipPath={`url(#${id}-clip)`}>
              <rect className="mask-generated-region" x={x(before)} y={top} width={x(before+duration)-x(before)} height={bottom-top}/>
              {[0,.25,.5,.75,1].map(value=><line key={value} className="mask-grid-line" x1={left} x2={right} y1={y(value)} y2={y(value)}/>)}
              {Array.from({length:9},(_,i)=><line key={i} className="mask-grid-line" x1={x(from+span*i/8)} x2={x(from+span*i/8)} y1={top} y2={bottom}/>)}
              {[before,before+duration].map((time,i)=><line key={i} className="mask-reference-boundary" x1={x(time)} x2={x(time)} y1={top} y2={bottom}/>)}
              <path className="mask-curve-line" d={curvePath(curve,before,duration,after,from,to,x,y)}/>
              <line className="mask-time-indicator" x1={x(cursor)} x2={x(cursor)} y1={top-5} y2={bottom+5}/>
              {(['start','end'] as const).filter(side=>side==='start'?before:after).flatMap(side=>curve[side].map((p,index)=>{
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
                        onKeyDown={event=>{const step=event.shiftKey ? .1 : .01;let t=handle.time,s=handle.strength;
                          if(event.key==='ArrowLeft')t-=span*step;if(event.key==='ArrowRight')t+=span*step;if(event.key==='ArrowUp')s+=step;if(event.key==='ArrowDown')s-=step;
                          if(event.key.startsWith('Arrow')){event.preventDefault();change(movedPoint(active,{side,index},t,s,direction));}}}/>
                      <circle className="mask-tangent-dot" cx={x(handle.time)} cy={y(handle.strength)} r={3}/>
                    </g>;
                  })}
                  <rect className="mask-keyframe-hit" x={x(time)-10} y={y(p.strength)-10} width={20} height={20} role="button" tabIndex={0} aria-label={label}
                    aria-pressed={chosen} onFocus={()=>setSelection({side,index})} onDoubleClick={e=>e.stopPropagation()} onPointerDown={e=>startDrag(e,{side,index})}
                    onKeyDown={event=>{
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
        <div className="mask-selection-label"><span>SELECTED KEYFRAME</span><strong>{selection?`${selection.side==='start'?'Start':'End'} · Keyframe ${selection.index+1}`:'Click a diamond'}</strong></div>
        <label>Time <span><input aria-label="Keyframe time" type="number" step={1/24} disabled={!point||endpoint} value={point?Number(seconds(selection!.side,point).toFixed(3)):''}
          onChange={event=>{if(point&&Number.isFinite(event.target.valueAsNumber))change(movedPoint(active,selection!,event.target.valueAsNumber,point.strength));}}/>s</span></label>
        <label>Regenerate <span><input aria-label="Keyframe regeneration" type="number" min={0} max={100} step={1} disabled={!point||boundary} value={point?Number((point.strength*100).toFixed(1)):''}
          onChange={event=>{if(point&&Number.isFinite(event.target.valueAsNumber))change(movedPoint(active,selection!,seconds(selection!.side,point),event.target.valueAsNumber/100));}}/>%</span></label>
        <button type="button" className="mask-delete-key" disabled={!selection||endpoint} onClick={remove}>Delete keyframe</button>
      </div>
      <div className="mask-curve-options"><label>Interpolation<select aria-label="Mask curve interpolation" value={curve.interpolation} onChange={event=>change({...draft,[active]:{...curve,interpolation:event.target.value as MaskCurve['interpolation']}})}>
        <option value="linear">Linear</option><option value="smooth">Easy ease</option><option value="bezier">Bézier</option></select></label>
        <button type="button" onClick={reset}><RotateCcw size={12}/>Reset {active}</button></div>
      <p className="mask-editor-help">Double-click a reference to add a keyframe. Drag diamonds to move them; use Bézier handles to shape the curve. The empty middle stays at 100%.</p>
      <footer className="mask-editor-footer"><span>Applies to the next generation.</span><button type="button" className="button" onClick={onClose}>Cancel</button><button type="button" className="button primary" onClick={apply}>Apply {active} mask</button></footer>
    </div>
  </ModalBackdrop>;
}
