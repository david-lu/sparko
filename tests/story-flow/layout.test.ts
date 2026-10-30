import { describe, expect, it } from 'vitest';
import { autoLayout, CLIP_HEIGHT, createNode, edge, nodeMediaLayout, PIXELS_PER_SECOND, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { fitCamera } from '../../src/features/story-flow/viewport';
import type { Interstitial } from '../../shared/interstitials';

const clip=(id:string,seconds=4):StoryNode=>({id,name:id,kind:'source',x:0,y:0,loopCount:0,source:{assetId:'video',inFrame:0,outFrame:seconds*24}});
const graph=(nodes:StoryNode[]):StoryGraph=>({version:1,entryId:nodes[0]?.id??'',nodes,edges:[],templates:[]});
const rects=(g:StoryGraph,items:Interstitial[])=>g.nodes.map(n=>{
  const media=nodeMediaLayout(n,items);
  return {left:n.x-media.before*PIXELS_PER_SECOND,right:n.x+(media.body+media.after)*PIXELS_PER_SECOND,top:n.y};
});
function expectFittedWithoutOverlap(g:StoryGraph,items:Interstitial[],height:number,width=1000,inside=true){
  const boxes=rects(g,items),bounds={left:Math.min(...boxes.map(b=>b.left)),right:Math.max(...boxes.map(b=>b.right)),top:Math.min(...boxes.map(b=>b.top)),bottom:Math.max(...boxes.map(b=>b.top))};
  const camera=fitCamera(bounds,width,height,2,!!g.groups?.length,boxes);
  const fitted=boxes.map(b=>({left:b.left*camera.zoom+camera.x,right:b.right*camera.zoom+camera.x,top:b.top*camera.rowScale+camera.y,bottom:b.top*camera.rowScale+camera.y+CLIP_HEIGHT}));
  for(const [i,a] of fitted.entries()){
    expect(a.left).toBeGreaterThanOrEqual(0);expect(a.right).toBeLessThanOrEqual(width);
    if(inside){expect(a.top).toBeGreaterThanOrEqual(0);expect(a.bottom).toBeLessThanOrEqual(height);}
    for(const b of fitted.slice(i+1))expect(a.right<=b.left||b.right<=a.left||a.bottom+20<=b.top||b.bottom+20<=a.top).toBe(true);
  }
}

describe('automatic clip layout',()=>{
  it.each([180,280,480])('packs disconnected clips of different lengths without overlap after fitting a %ipx canvas',height=>{
    const original=graph(Array.from({length:18},(_,i)=>clip(`clip-${i}`,1+i%7)));
    original.entryId='clip-4';
    const result=autoLayout(original,[],height);
    expectFittedWithoutOverlap(result,[],height);expectFittedWithoutOverlap(result,[],height,390);
    expect(new Set(result.nodes.map(n=>n.x)).size).toBeGreaterThan(1);
    expect(result.nodes.map(({x,y,...n})=>n)).toEqual(original.nodes.map(({x,y,...n})=>n));
    expect(result.edges).toEqual([]);expect(result.entryId).toBe('clip-4');
    expect(autoLayout(result,[],height)).toEqual(result);
    expect(original.nodes.every(n=>n.x===0&&n.y===0)).toBe(true);
  });
  it('keeps branches, merging inputs, cycles, isolated clips and grouped members separate',()=>{
    const original=graph(Array.from({length:16},(_,i)=>clip(`clip-${i}`,2+i%5)));
    original.edges=[edge('clip-0','clip-2'),edge('clip-1','clip-2'),...Array.from({length:6},(_,i)=>edge('clip-2',`clip-${i+3}`)),edge('clip-9','clip-10'),edge('clip-10','clip-9')];
    original.groups=[{id:'group',name:'Loose footage',nodeIds:['clip-11','clip-13','clip-15'],color:'blue'}];
    const result=autoLayout(original,[],320);
    expectFittedWithoutOverlap(result,[],320,1000,false);expect(result.edges).toEqual(original.edges);expect(result.groups).toBe(original.groups);
    const members=result.nodes.filter(n=>original.groups![0].nodeIds.includes(n.id)),left=Math.min(...members.map(n=>n.x)),right=Math.max(...members.map(n=>n.x+nodeMediaLayout(n,[]).total*PIXELS_PER_SECOND));
    for(const n of result.nodes.filter(n=>!members.includes(n)))expect(n.x+nodeMediaLayout(n,[]).total*PIXELS_PER_SECOND<=left||n.x>=right).toBe(true);
  });
  it.each([180,280,480])('stacks conditional destinations in one column at %ipx, even inside a template',height=>{
    const {node,item}=createNode('conditional'),outputs=[clip('yes',3),clip('no',8),clip('maybe',5)];
    const original=graph([node,...outputs,...Array.from({length:8},(_,i)=>clip(`loose-${i}`))]);
    original.edges=outputs.map(n=>edge(node.id,n.id,'answer',n.name));
    original.groups=[{id:'choice',name:'Choice',color:'blue',nodeIds:[node.id,...outputs.map(n=>n.id)]}];
    const result=autoLayout(original,[item],height),branches=result.nodes.filter(n=>outputs.some(o=>o.id===n.id)),choice=result.nodes[0];
    expect(new Set(branches.map(n=>n.x)).size).toBe(1);
    expect(branches[0].x).toBeGreaterThan(choice.x);expect(branches.map(n=>n.y)).toEqual([...branches.map(n=>n.y)].sort((a,b)=>a-b));
    expect(choice.y).toBe((branches[0].y+branches.at(-1)!.y)/2);
    expectFittedWithoutOverlap(result,[item],height,1000,false);expect(autoLayout(result,[item],height)).toEqual(result);
  });
  it('includes generated reference handles and removes old bends without changing clip or fade data',()=>{
    const {node,item}=createNode('simple');
    const ready:Interstitial={...item,phase:'ready',result:{url:'asset:render',start:10,duration:4,totalDuration:30}};
    const original=graph([clip('before',12),node,clip('after',2),clip('loose',30)]);
    original.edges=[{...edge('before',node.id),crossfade:.75,points:[{id:'old-bend',x:-90000,y:80000}]},edge(node.id,'after')];
    const result=autoLayout(original,[ready],280);
    expectFittedWithoutOverlap(result,[ready],280);
    expect(result.edges[0]).toEqual({...original.edges[0],points:undefined});
    expect(result.nodes.map(({x,y,...n})=>n)).toEqual(original.nodes.map(({x,y,...n})=>n));
  });
  it('handles empty projects and self-loops',()=>{
    const empty=graph([]);expect(autoLayout(empty,[])).toBe(empty);
    const loop=graph([clip('loop')]);loop.edges=[edge('loop','loop')];
    const result=autoLayout(loop,[]);expect(Number.isFinite(result.nodes[0].x)).toBe(true);expect(result.edges).toEqual(loop.edges);
  });
});
