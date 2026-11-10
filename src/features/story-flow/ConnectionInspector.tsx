import { TIMELINE_FPS } from '../../../shared/constants';
import type { MediaInfo } from '../../media/media';
import { sceneFrames } from '../call-response/model';
import { flowTransition } from '../call-response/transitions';
import type { FadeCurve } from '../../../shared/fade-curves';
import CrossfadeCurveField from './CrossfadeCurveField';
import { connectionFade, runtimeFlow, type FadeChannel, type StoryEdge } from './model';
import { sceneMediaRange } from './mediaRange';
import type { StoryEditor } from './useStoryEditor';
import { connectionReference } from './references';

const seconds = (value: number) => `${value.toFixed(3)} s`;
export default function ConnectionInspector({ editor, connection, info }: {editor:StoryEditor;connection:StoryEdge;info:MediaInfo|null}) {
  const graph=editor.graph!,project=editor.projects.getSnapshot().project;
  const flow=runtimeFlow(graph,editor.items,project?.source.assetId??'',info?.duration??1);
  const link=flow.edges.find(e=>e.id===connection.id)!,before=flow.scenes.find(s=>s.id===link.from)!,after=flow.scenes.find(s=>s.id===link.to)!;
  const fps=TIMELINE_FPS;
  const channels = (['video', 'audio'] as const).map(channel => ({ channel, label: channel === 'video' ? 'Video' : 'Audio',
    duration: connectionFade(connection, graph.nodes, editor.items, channel), transition: flowTransition(flow, link, undefined, channel) }));
  const patch=(channel:FadeChannel,crossfade:number)=>editor.change({...graph,edges:graph.edges.map(e=>e.id===connection.id?{...e,[`${channel}Crossfade`]:Math.round(Math.max(0,crossfade)*fps)/fps}:e)});
  // Linear is the default shape, so it is stored as no curve at all.
  const shape=(channel:FadeChannel,curve?:FadeCurve)=>editor.change({...graph,edges:graph.edges.map(e=>{
    if(e.id!==connection.id)return e;
    const next={...e},key=channel==='video'?'videoCrossfadeCurve':'audioCrossfadeCurve';
    if(curve)next[key]=curve;else delete next[key];
    return next;
  })});
  const self=before.id===after.id,draft=before.draft||after.draft,reference=connectionReference(flow,link);
  return <div className="story-inspector connection-inspector" data-project-edit>
    <span className="eyebrow">CONNECTION</span><h2>Crossfade</h2>
    <p className="connection-names"><span>{before.label}</span><span aria-hidden>→</span><span>{after.label}</span></p>
    {channels.map(({channel,label,duration,transition})=><div className="connection-fade-control" key={`${connection.id}:${channel}`}>
      <CrossfadeCurveField name={`${label} crossfade`} label={`${label} fade`} duration={duration} max={Math.max(duration,Math.min(sceneFrames(before),sceneFrames(after))/fps)} step={1/fps}
        curve={connection[`${channel}CrossfadeCurve`]} cut={transition&&-transition.startFrame/transition.frames} disabled={self}
        onDuration={value=>patch(channel,value)} onCurve={curve=>shape(channel,curve)} onBoundary={()=>editor.projects.endHistoryGroup()}/>
      <p className="hint">{connection[`${channel}Crossfade`]===undefined&&connection.crossfade===undefined&&connection.crossfadeReferenceRatio!==undefined
        ?`Automatic: ${Math.round(connection.crossfadeReferenceRatio*100)}% of the reference. Drag the end point or edit the length to fix it.`
        :`Drag the end point to change the length; 0 makes ${channel === 'video' ? 'a picture cut' : 'an audio cut'}. Applies only to this connection.`}</p>
    </div>)}
    <div className={`connection-reference-status ${reference.state}`} aria-label="Reference matching"><strong>{reference.state==='mismatch'?'Reference mismatch':reference.state==='match'?'References match':'Reference check'}</strong><p className="hint">{reference.message}</p></div>
    <section className="connection-timing" aria-label="Crossfade timing">
      {channels.map(({channel,label,duration,transition})=><div className="connection-channel-timing" key={channel} aria-label={`${label} crossfade timing`}>
      {transition?<><strong>{label} · {seconds(transition.frames/fps)} {channel==='video'?'dissolve':'fade'}</strong>
        <p className="hint">{transition.startFrame+transition.frames===0?'Finishes at the cut, using the incoming clip’s opening footage.':transition.startFrame===0?'Starts at the cut, using the outgoing clip’s ending footage.':channel==='video'?'Centered on the cut. Missing extra footage holds on its boundary frame.':'Centered on the cut. Missing extra audio is silent.'}</p>
        <dl>{[before,after].map((scene,index)=>{
          const range=sceneMediaRange(scene,fps),start=(index===0?range.end:range.start)+transition.startFrame/fps;
          return <div key={scene.id}><dt>{scene.label}{index===1&&after.generated&&transition.startFrame+transition.frames===0?' · opening footage':index===0&&before.generated&&transition.startFrame===0?' · ending footage':''}</dt>
            <dd>{seconds(Math.max(0,start))} – {seconds(Math.min(range.total??Infinity,start+transition.frames/fps))}</dd></div>;
        })}</dl><p className="hint">Times are positions in each saved video.</p>
        {transition.frames<Math.round(duration*fps)&&<p className="hint">Shortened to fit the available footage without overlapping another fade.</p>}
      </>:<><strong>{label} · {self?'Seamless repeat':duration===0?'Cut':draft?'Ready after generation':'Cut · no available overlap'}</strong>
        <p className="hint">{self?'Set the repeat crossfade in the clip’s Loop settings.':duration===0?'Playback changes clips directly.':draft?'The saved footage will determine the overlap when generation finishes.':'There is not enough footage for this overlap.'}</p></>}
      </div>)}
    </section>

  </div>;
}
