import { describe, expect, it } from 'vitest';
import { curveStrength, defaultMaskCurve, maskCurveSchema, maskStrength, type MaskCurve } from '../../shared/mask-curves';
import { hasUnsubmittedChanges, interstitialSettings, type Interstitial } from '../../shared/interstitials';
import { comfyBridgePlan } from '../../shared/comfy';
import { bridgeWorkflow, type Workflow } from '../../server/features/comfy/workflow';

const curve = (): MaskCurve => ({ interpolation:'bezier',
  start:[{position:0,strength:.1,out:{influence:.6,strength:.1}},{position:.5,strength:.3,in:{influence:.1,strength:.2}},{position:1,strength:1}],
  end:[{position:0,strength:1},{position:.7,strength:.2},{position:1,strength:0}] });

function audioValues(graph:Workflow,length:number) {
  const read=(ref:unknown):number[]=>{
    const node=graph[(ref as [string,number])[0]],input=node.inputs;
    if(node.class_type==='SolidMask') return Array(typeof input.width==='number'?input.width:length).fill(Number(input.value));
    if(node.class_type==='MaskComposite') {
      const destination=read(input.destination),source=read(input.source),x=Number(input.x);
      expect(x).toBeLessThanOrEqual(destination.length);
      source.forEach((value,i)=>{if(x+i<destination.length)destination[x+i]+=value;});return destination;
    }
    throw Error(`Unexpected mask node ${node.class_type}`);
  };
  return read(graph.freeze_audio.inputs.mask);
}

describe('mask keyframes',()=>{
  it('evaluates linear, eased, and Bézier curves by time rather than by handle parameter',()=>{
    const points=[{position:0,strength:0},{position:1,strength:1}];
    expect(curveStrength(points,.25,'linear')).toBe(.25);
    expect(curveStrength(points,.25,'smooth')).toBe(.15625);
    expect(curveStrength(points,.25,'bezier')).toBeCloseTo(.15625,5);
    // Controls (x=0, y=1) and (x=0, y=1) produce x=t³ and y=1-(1-t)³.
    const bezier=[{...points[0],out:{influence:0,strength:1}},{...points[1],in:{influence:1,strength:1}}];
    expect(curveStrength(bezier,.125,'bezier')).toBeCloseTo(.875,5);
    expect(maskStrength(curve(),4,2,6,2)).toBe(1);
  });
  it.each([0,250,500,4000])('creates reference-relative defaults from a %i ms transition',milliseconds=>{
    const value=defaultMaskCurve(2,3,milliseconds);
    expect(maskCurveSchema.safeParse(value).success).toBe(true);
    expect(maskStrength(value,4,2,6,3)).toBe(1);
    if(!milliseconds){expect(maskStrength(value,1.99,2,6,3)).toBe(0);expect(maskStrength(value,8.01,2,6,3)).toBe(0);}
  });
  it('rejects unordered, duplicate, out-of-range, excessive, and unlocked boundary pins',()=>{
    const valid=curve();
    const invalid=[{...valid,start:[]},{...valid,end:[]},{...valid,start:[valid.start[0]]},{...valid,start:[...valid.start].reverse()},
      {...valid,start:[valid.start[0],valid.start[0],valid.start[2]]},
      {...valid,start:[{position:0,strength:-1},valid.start[2]]},
      {...valid,start:[valid.start[0],{position:1,strength:.5}]},
      {...valid,end:[{position:0,strength:0},valid.end[2]]},
      {...valid,start:[{position:0,strength:0,out:{influence:2,strength:0}},valid.start[2]]},
      {...valid,start:Array.from({length:17},(_,i)=>({position:i/16,strength:i/16}))}];
    for(const input of invalid)expect(maskCurveSchema.safeParse(input).success).toBe(false);
  });
  it('snapshots curves without sharing handles and compares submitted settings structurally',()=>{
    const item:Interstitial={id:'clip',label:'Clip',time:2,start_range:2,end_range:2,duration:6,prompt:'Continue',enable_prompt_expansion:false,phase:'ready',videoMaskCurve:curve()};
    item.generationSettings=interstitialSettings(item);
    expect(hasUnsubmittedChanges(item)).toBe(false);
    item.videoMaskCurve!.start[0].out!.strength=.6;
    expect(item.generationSettings.videoMaskCurve!.start[0].out!.strength).toBe(.1);
    expect(hasUnsubmittedChanges(item)).toBe(true);
    item.videoMaskCurve=structuredClone(item.generationSettings.videoMaskCurve);
    expect(hasUnsubmittedChanges(item)).toBe(false);
    item.audioMaskCurve=curve();expect(hasUnsubmittedChanges(item)).toBe(true);
  });
  it.each([[1.625,1.625],[4,1.625],[1.625,0],[0,1.625],[0,0]])('compiles independent masks on the video and audio clocks for %s / %s references',(before,after)=>{
    const video=curve(),audio=curve();audio.interpolation='smooth';audio.start[1].strength=.8;
    const plan=comfyBridgePlan(before,after,6,'custom');
    const input={before,after,duration:6,mode:'custom' as const,width:960,height:544,hasAudio:true,prompt:'Continue',videoMaskCurve:video,audioMaskCurve:audio};
    const graph=bridgeWorkflow(before||after?'asset':undefined,input,1);
    if(!before&&!after){expect(graph.freeze_audio).toBeUndefined();return;}
    const values=String(graph.middle_mask.inputs.points_string).split(',').map(point=>Number(point.split(':(')[1].slice(0,-1)));
    expect(values).toHaveLength(plan.totalFrames);
    expect(values.slice(plan.prefixFrames,plan.totalFrames-plan.suffixFrames).every(v=>v===1)).toBe(true);
    expect(values.every(v=>v>=0&&v<=1)).toBe(true);
    for(const length of [Math.floor(plan.totalFrames/24*40),Math.ceil(plan.totalFrames/24*40)+7]) {
    const masks=audioValues(graph,length);
    const first=Math.floor(plan.insertion.start*40),end=Math.ceil((plan.insertion.start+plan.insertion.duration)*40);
    expect(masks).toHaveLength(length);expect(masks.slice(first,end).every(v=>v===1)).toBe(true);
    expect(masks.every(v=>v>=0&&v<=1)).toBe(true);
    if(before){const i=Math.floor(before*.5*40);expect(masks[i]).toBeGreaterThan(values[Math.floor(before*.5*24)]);}
    expect(masks.at(-1)).toBe(after?0:1);
    }
    const audioOnly=bridgeWorkflow('asset',{...input,videoMaskCurve:undefined},1);
    const baseline=bridgeWorkflow('asset',{...input,videoMaskCurve:undefined,audioMaskCurve:undefined},1);
    expect(audioOnly.middle_mask).toEqual(baseline.middle_mask);
    const videoOnly=bridgeWorkflow('asset',{...input,audioMaskCurve:undefined},1);
    expect(videoOnly.audio_mask).toEqual(baseline.audio_mask);
  });
  it('extends a partially regenerated audio endpoint through fitted padding without overlapping spans',()=>{
    const audio=curve();audio.end.at(-1)!.strength=.6;
    const plan=comfyBridgePlan(1.625,1.625,6);
    const graph=bridgeWorkflow('asset',{before:1.625,after:1.625,duration:6,width:960,height:544,prompt:'Continue',hasAudio:true,audioMaskCurve:audio},1);
    for(const length of [Math.floor(plan.totalFrames/24*40),Math.ceil(plan.totalFrames/24*40)+7]){
      const values=audioValues(graph,length);
      expect(values.at(-1)).toBe(.6);expect(values.every(value=>value>=0&&value<=1)).toBe(true);
    }
  });
});
