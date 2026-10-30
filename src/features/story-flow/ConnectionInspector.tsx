import { TIMELINE_FPS } from '../../../shared/constants';
import type { MediaInfo } from '../../media/media';
import { flowTransition } from '../call-response/transitions';
import { connectionFade, runtimeFlow, type StoryEdge } from './model';
import { sceneMediaRange } from './mediaRange';
import type { StoryEditor } from './useStoryEditor';
import { connectionReference } from './references';

const seconds = (value: number) => `${value.toFixed(3)} s`;
export default function ConnectionInspector({ editor, connection, info }: {editor:StoryEditor;connection:StoryEdge;info:MediaInfo|null}) {
  const graph=editor.graph!,project=editor.projects.getSnapshot().project;
  const flow=runtimeFlow(graph,editor.items,project?.source.assetId??'',info?.duration??1);
  const link=flow.edges.find(e=>e.id===connection.id)!,before=flow.scenes.find(s=>s.id===link.from)!,after=flow.scenes.find(s=>s.id===link.to)!;
  const duration=connectionFade(connection,graph.nodes),transition=flowTransition(flow,link),fps=TIMELINE_FPS;
  const patch=(crossfade:number)=>editor.change({...graph,edges:graph.edges.map(e=>e.id===connection.id?{...e,crossfade:Math.round(Math.max(0,crossfade)*fps)/fps}:e)});
  const self=before.id===after.id,draft=before.draft||after.draft,reference=connectionReference(flow,link);
  return <div className="story-inspector connection-inspector" data-project-edit>
    <span className="eyebrow">CONNECTION</span><h2>Crossfade</h2>
    <p className="connection-names"><span>{before.label}</span><span aria-hidden>→</span><span>{after.label}</span></p>
    <label className="field">Duration (seconds)<input aria-label="Crossfade duration" type="number" min={0} step={1/fps}
      value={Number(duration.toFixed(3))} disabled={self} onChange={e=>Number.isFinite(e.target.valueAsNumber)&&patch(e.target.valueAsNumber)}/></label>
    <p className="hint">Set to 0 for a cut. This setting applies only to this connection.</p>
    <div className={`connection-reference-status ${reference.state}`} aria-label="Reference matching"><strong>{reference.state==='mismatch'?'Reference mismatch':reference.state==='match'?'References match':'Reference check'}</strong><p className="hint">{reference.message}</p></div>
    <section className="connection-timing" aria-label="Crossfade timing">
      {transition?<><strong>{seconds(transition.frames/fps)} dissolve</strong>
        <p className="hint">{after.generated?'Finishes at the cut, before the generated section begins.':before.generated?'Starts at the cut, using the ending reference.':'Centered on the cut. Missing extra footage holds on its boundary frame.'}</p>
        <dl>{[before,after].map((scene,index)=>{
          const range=sceneMediaRange(scene,fps),start=(index===0?range.end:range.start)+transition.startFrame/fps;
          return <div key={scene.id}><dt>{scene.label}{index===1&&after.generated?' · opening reference':index===0&&before.generated&&!after.generated?' · ending reference':''}</dt>
            <dd>{seconds(Math.max(0,start))} – {seconds(Math.min(range.total??Infinity,start+transition.frames/fps))}</dd></div>;
        })}</dl><p className="hint">Times are positions in each saved video.</p>
        {transition.frames<Math.round(duration*fps)&&<p className="hint">Shortened to fit the available footage without overlapping another fade.</p>}
      </>:<><strong>{self?'Seamless repeat':duration===0?'Cut':draft?'Ready after generation':'Cut · no matching reference'}</strong>
        <p className="hint">{self?'Repeats play without a crossfade.':duration===0?'Playback changes clips directly.':draft?'The saved reference footage will determine the overlap when generation finishes.':'The saved reference does not meet this cut. Regenerate using the connected clips, or keep a cut.'}</p></>}
    </section>

  </div>;
}
