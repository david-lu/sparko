import { playableResult, type Interstitial, type ClipReference } from '../../../shared/interstitials';
import { behaviors } from './behaviors';
import { TIMELINE_FPS } from '../../../shared/constants';
import { generatedBounds, type StoryNode } from './model';

export default function GeneratedVideoInfo({item,node,nodes,items}:{item:Interstitial;node:StoryNode;nodes:StoryNode[];items:Interstitial[]}) {
  const result=playableResult(item);if(!result)return null;
  const range=result.fullAssetId ? result.fullRange ?? (result===item.result?item.requestInsertion:undefined) : result;
  const format=(seconds:number)=>`${seconds.toFixed(3)} s`,span=(start:number,end:number)=>`${format(start)} – ${format(end)}`;
  if(!range)return <section className="generated-video-info" aria-label="Video breakdown"><h3>Saved video</h3><p className="hint">{format(result.duration)} playable loop. Reference timings were not saved with this older render.</p></section>;
  const end=range.start+range.duration,tail=Math.max(0,range.totalDuration-end),bounds=generatedBounds(node,result.duration);
  const reference=(ref:ClipReference|undefined,length:number,ending:boolean)=>{
    if(!ref)return 'Reference footage saved with this render';
    const source=nodes.find(n=>n.id===ref.sceneId)??nodes.find(n=>n.source?.assetId===ref.assetId||items.some(i=>i.id===n.interstitialId&&(playableResult(i)?.assetId===ref.assetId||playableResult(i)?.fullAssetId===ref.assetId)));
    const name=items.find(i=>i.id===source?.interstitialId)?.label??source?.name??'Saved reference clip';
    const start=ending&&result.reference?.mode!=='loop'?ref.inFrame/TIMELINE_FPS:Math.max(ref.inFrame/TIMELINE_FPS,ref.outFrame/TIMELINE_FPS-length);
    return `${name} · ${span(start,start+length)}`;
  };
  const sections=[{id:'reference',label:'Opening reference',start:0,end:range.start,detail:reference(result.reference?.before,range.start,false)},
    {id:'generated',label:'Generated section',start:range.start,end,detail:'New video created for this clip'},
    {id:'reference',label:'Ending reference',start:end,end:range.totalDuration,detail:reference(result.reference?.after,tail,true)}].filter(s=>s.end-s.start>1e-6);
  return <section className="generated-video-info" aria-label="Video breakdown"><h3>Video breakdown <span>{format(range.totalDuration)} total</span></h3>
    <p className="hint">{item.phase==='ready'?'Actual timings in the saved video.':'Showing the last playable video while its replacement is pending.'}</p>
    <div className="generated-video-bar" aria-hidden>{sections.map(s=><span key={s.label} className={s.id} style={{flex:s.end-s.start}} title={s.label}/>)}</div>
    <dl>{sections.map(s=><div key={s.label} className={s.id}><dt>{s.label}<small>{format(s.end-s.start)}</small></dt><dd>{span(s.start,s.end)}<small>{s.detail}</small></dd></div>)}</dl>
    <p className="generated-play-range"><strong>Used in the timeline</strong><span>{span(range.start+bounds.inFrame/TIMELINE_FPS,range.start+bounds.outFrame/TIMELINE_FPS)}</span><small>{format((bounds.outFrame-bounds.inFrame)/TIMELINE_FPS)}{behaviors(node).loop?' per repeat':''}. Reference sections stay outside the clip.</small></p>
  </section>;
}
