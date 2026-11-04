import { describe, expect, it } from 'vitest';
import { autoLayout, CLIP_HEIGHT, createNode, edge, nodeMediaLayout, nodeVisualBounds, PIXELS_PER_SECOND, type StoryGraph, type StoryNode } from '../../src/features/story-flow/model';
import { fitCamera } from '../../src/features/story-flow/viewport';
import type { Interstitial } from '../../shared/interstitials';

const clip=(id:string,seconds=4):StoryNode=>({id,name:id,kind:'source',x:0,y:0,loopCount:0,source:{assetId:'video',inFrame:0,outFrame:seconds*24}});
const graph=(nodes:StoryNode[]):StoryGraph=>({version:1,entryId:nodes[0]?.id??'',nodes,edges:[],templates:[]});
const rects=(g:StoryGraph,items:Interstitial[])=>g.nodes.map(n=>{
  const media=nodeMediaLayout(n,items);
  return {left:n.x-media.before*PIXELS_PER_SECOND,right:n.x+(media.body+media.after)*PIXELS_PER_SECOND,top:n.y};
});
function expectNoOverlap(g:StoryGraph,items:Interstitial[]=[]){
  const boxes=rects(g,items);
  for(const [i,a] of boxes.entries())for(const b of boxes.slice(i+1)){
    expect(a.right<=b.left||b.right<=a.left||a.top+CLIP_HEIGHT<=b.top||b.top+CLIP_HEIGHT<=a.top).toBe(true);
  }
}
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
  it.each([false,true])('keeps short destinations compact beside a tall conditional (grouped %s)',grouped=>{
    const choice={...clip('choice'),conditional:true,conditions:Array.from({length:10},(_,i)=>({id:`c-${i}`,label:`Choice ${i}`,values:[]}))};
    const original=graph([choice,clip('upper'),clip('middle'),clip('lower')]);
    original.edges=original.nodes.slice(1).map(n=>edge(choice.id,n.id));
    if(grouped)original.groups=[{id:'group',name:'Choice',color:'blue',nodeIds:original.nodes.map(n=>n.id)}];
    const result=autoLayout(original,[],480),[parent,...children]=result.nodes;
    for(let i=1;i<children.length;i++)expect(children[i].y-children[i-1].y-CLIP_HEIGHT).toBe(24);
    expect(parent.y).toBe(children[1].y);
    const labelEnd=parent.x+128+nodeVisualBounds(result,parent).rightOverflow;
    expect(children[0].x-labelEnd).toBe(grouped?50:24);
    expectNoOverlap(result);expect(autoLayout(result,[],480)).toEqual(result);
  });
  it('adds height only between the neighboring clips that need it',()=>{
    const tall={...clip('tall'),conditional:true,conditions:Array.from({length:8},(_,i)=>({id:`c-${i}`,label:`Choice ${i}`,values:[]}))};
    const original=graph([clip('entry'),{...tall,y:0},{...clip('short'),y:100},{...tall,id:'lower',y:200}]);
    original.edges=original.nodes.slice(1).map(n=>edge('entry',n.id));
    const result=autoLayout(original,[]),neighbors=result.nodes.slice(1);
    for(let i=1;i<neighbors.length;i++){
      const upper=neighbors[i-1],lower=neighbors[i];
      expect(lower.y+nodeVisualBounds(result,lower).topOffset-upper.y-nodeVisualBounds(result,upper).bottomOffset).toBe(24);
    }
    expect(autoLayout(result,[])).toEqual(result);
  });
  it.each([180,480])('reserves the full height of conditional sockets, even without connected outputs, at %ipx',height=>{
    const conditions=Array.from({length:8},(_,i)=>({id:`condition-${i}`,label:`Choice ${i+1}`,values:[]}));
    const original=graph([clip('entry'),{...clip('upper'),conditional:true,conditions,y:1000},{...clip('lower'),conditional:true,conditions,y:2000}]);
    original.edges=[edge('entry','upper'),edge('entry','lower')];
    const result=autoLayout(original,[],height),upper=result.nodes[1],lower=result.nodes[2];
    expect(lower.x).toBe(upper.x);
    expect(lower.y+nodeVisualBounds(result,lower).topOffset-(upper.y+nodeVisualBounds(result,upper).bottomOffset)).toBeGreaterThanOrEqual(24);
    const boxes=rects(result,[]).map((box,i)=>({...box,...nodeVisualBounds(result,result.nodes[i])}));
    const camera=fitCamera({left:40,right:600,top:90,bottom:lower.y},800,height,2,false,boxes);
    expect((lower.y-upper.y)*camera.rowScale+boxes[2].topOffset-boxes[1].bottomOffset).toBeGreaterThanOrEqual(24);
    expect(autoLayout(result,[],height)).toEqual(result);
  });
  it('moves loose clips only when they collide with conditional outputs, and preserves clear neighbors',()=>{
    const conditional={...clip('entry'),conditional:true,x:40,y:129,conditions:Array.from({length:8},(_,i)=>({id:`c-${i}`,label:`Choice ${i}`,values:[]}))};
    const original=graph([conditional,{...clip('collision',1),x:180,y:230},{...clip('clear'),x:1000,y:600}]);
    const result=autoLayout(original,[]),a=result.nodes[0],b=result.nodes[1],av=nodeVisualBounds(result,a),bv=nodeVisualBounds(result,b);
    expect(result.nodes[2]).toEqual(original.nodes[2]);expect(b).not.toEqual(original.nodes[1]);
    expect(a.x+128+av.rightOverflow<=b.x||b.x+32<=a.x||a.y+av.bottomOffset<=b.y+bv.topOffset||b.y+bv.bottomOffset<=a.y+av.topOffset).toBe(true);
    expect(autoLayout(result,[])).toEqual(result);
  });
  it.each([180,280,480])('moves a disconnected composition with its entry while preserving relative positions at %ipx',height=>{
    const original=graph([
      {...clip('right'),x:1000,y:90},
      {...clip('middle-bottom'),x:500,y:300},
      {...clip('left'),x:-300,y:90},
      {...clip('middle-top'),x:500,y:90},
    ]);
    const result=autoLayout(original,[],height);
    expect(result.nodes).toEqual(original.nodes.map(n=>({...n,x:n.x-960})));
    expect(autoLayout(result,[],height)).toEqual(result);
  });
  it.each([180,280,480])('brings nearby loose clips along when a distant path is laid out at %ipx',height=>{
    const original=graph([{...clip('start'),x:5000,y:4000},{...clip('end'),x:6000,y:4500},
      {...clip('near-start'),x:5030,y:4180},{...clip('near-end'),x:6160,y:4500}]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[],height);
    expect(result.nodes[0]).toMatchObject({x:40,y:90});expect(result.nodes[1]).toMatchObject({x:272,y:90});
    expect(result.nodes[2]).toEqual({...original.nodes[2],x:70,y:270});
    expect(result.nodes[3]).toEqual({...original.nodes[3],x:432,y:90});
    expectNoOverlap(result);expect(autoLayout(result,[],height)).toEqual(result);
    expect(original.nodes[2]).toMatchObject({x:5030,y:4180});
  });
  it('follows separate nearby paths using their own movement',()=>{
    const original=graph([{...clip('a'),x:5000,y:6000},{...clip('a-end'),x:5500,y:6000},
      {...clip('b'),x:-4000,y:-2000},{...clip('b-end'),x:-3300,y:-2000},
      {...clip('near-a'),x:5000,y:5820},{...clip('near-b'),x:-4000,y:-1820}]);
    original.edges=[edge('a','a-end'),edge('b','b-end')];
    const result=autoLayout(original,[],180);
    expect(result.nodes[4]).toEqual({...original.nodes[4],x:result.nodes[0].x,y:result.nodes[0].y-180});
    expect(result.nodes[5]).toEqual({...original.nodes[5],x:result.nodes[2].x,y:result.nodes[2].y+180});
    expect(result.nodes[0].x-original.nodes[0].x).not.toBe(result.nodes[2].x-original.nodes[2].x);
    expectNoOverlap(result);expect(autoLayout(result,[],180)).toEqual(result);
  });
  it('measures proximity to the visible end of long clips',()=>{
    const original=graph([{...clip('long',100),x:1000,y:1000},{...clip('end'),x:4400,y:1120},
      {...clip('near-long'),x:4150,y:1120}]);
    original.edges=[edge('long','end')];
    const result=autoLayout(original,[]);
    expect(result.nodes[2]).toEqual({...original.nodes[2],x:3190,y:210});
    expectNoOverlap(result);expect(autoLayout(result,[])).toEqual(result);
  });
  it('resolves overlaps introduced by preserving relative placement',()=>{
    const original=graph([{...clip('start'),x:5000,y:5000},{...clip('end'),x:6000,y:5000},
      {...clip('near-start'),x:5180,y:5000}]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[]);
    expect(result.nodes[2]).toEqual({...original.nodes[2],x:220,y:190});
    expectNoOverlap(result);expect(autoLayout(result,[])).toEqual(result);
  });
  it.each([180,280,480])('preserves loose clips around and in gaps within the new layout at %ipx',height=>{
    const loose=[{...clip('before'),x:-300,y:40},{...clip('gap',1),x:190,y:90},
      {...clip('above'),x:60,y:-20},{...clip('below'),x:50,y:180},{...clip('far'),x:1000,y:500}];
    const original=graph([
      {...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},...loose,
    ]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[],height);
    expect(result.nodes[0]).toMatchObject({x:40,y:90});expect(result.nodes[1]).toMatchObject({x:272,y:90});
    expect(result.nodes.slice(2)).toEqual(loose);
    expect(result.entryId).toBe(original.entryId);expect(result.edges).toEqual(original.edges);
    expect(autoLayout(result,[],height)).toEqual(result);expectNoOverlap(result);
  });
  it('moves only a colliding loose clip to the closest clear position',()=>{
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},
      {...clip('collision'),x:100,y:100},{...clip('clear'),x:1000,y:800}]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[]);
    expect(result.nodes[2]).toEqual({...original.nodes[2],y:190});expect(result.nodes[3]).toEqual(original.nodes[3]);
    expect(result.nodes.map(({x,y,...n})=>n)).toEqual(original.nodes.map(({x,y,...n})=>n));
    expect(autoLayout(result,[])).toEqual(result);expectNoOverlap(result);
    expect(original.nodes[2]).toMatchObject({x:100,y:100});
  });
  it('reserves unaffected neighbors before resolving collisions, without cascading moves',()=>{
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},{...clip('collision'),x:100,y:100},
      {...clip('neighbor'),x:100,y:190}]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[]);
    expect(result.nodes[3]).toEqual(original.nodes[3]);expect(result.nodes[2]).toEqual({...original.nodes[2],y:-10});
    expect(autoLayout(result,[])).toEqual(result);expectNoOverlap(result);
  });
  it('resolves several colliding clips locally without overlapping each other',()=>{
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},...['one','two','three'].map(id=>({...clip(id),x:100,y:100}))]);
    original.edges=[edge('start','end')];
    const result=autoLayout(original,[]);
    for(const n of result.nodes.slice(2))expect(Math.hypot(n.x-100,n.y-100)).toBeLessThanOrEqual(200);
    expect(autoLayout(result,[])).toEqual(result);expectNoOverlap(result);
  });
  it('detects collisions with reference handles on a connected clip',()=>{
    const {node,item}=createNode('simple');node.x=592;
    const ready:Interstitial={...item,phase:'ready',result:{url:'asset:render',start:10,duration:4,totalDuration:15}};
    const original=graph([{...clip('source'),x:40,y:90},node,{...clip('before-handle',1),x:300,y:90},{...clip('after-handle',1),x:730,y:90}]);
    original.edges=[edge('source',node.id)];
    const result=autoLayout(original,[ready]);
    expect(result.nodes[1].x).toBe(592);
    for(const i of [2,3])expect(result.nodes[i]).not.toEqual(original.nodes[i]);
    expect(autoLayout(result,[ready])).toEqual(result);expectNoOverlap(result,[ready]);
  });
  it('includes a loose clip’s reference handles when finding a clear position',()=>{
    const {node,item}=createNode('simple');node.x=500;node.y=100;
    const ready:Interstitial={...item,phase:'ready',result:{url:'asset:render',start:10,duration:4,totalDuration:15}};
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},node]);original.edges=[edge('start','end')];
    const result=autoLayout(original,[ready]);
    expect(result.nodes[2]).toEqual({...node,y:190});expectNoOverlap(result,[ready]);
    expect(autoLayout(result,[ready])).toEqual(result);
  });
  it('keeps the current vertical order of parallel branches',()=>{
    const original=graph([{...clip('start'),x:30,y:200},{...clip('bottom'),x:500,y:400},{...clip('top'),x:530,y:70}]);
    original.edges=[edge('start','bottom'),edge('start','top')];
    const result=autoLayout(original,[],280),get=(id:string)=>result.nodes.find(n=>n.id===id)!;
    expect(get('top').y).toBeLessThan(get('bottom').y);expect(get('top').x).toBe(get('bottom').x);
    expect(autoLayout(result,[],280)).toEqual(result);expectFittedWithoutOverlap(result,[],280);
  });
  it.each([180,280,480])('translates a disconnected group and its frame together at %ipx',height=>{
    const original=graph([{...clip('last'),x:700,y:90},{...clip('bottom'),x:40,y:240},{...clip('top'),x:40,y:90}]);
    original.groups=[{id:'group',name:'Loose clips',nodeIds:original.nodes.map(n=>n.id),color:'blue',bounds:{x:0,y:0,width:1000,height:400}}];
    const result=autoLayout(original,[],height);
    expect(result.nodes).toEqual(original.nodes.map(n=>({...n,x:n.x-660})));
    expect(result.groups![0]).toEqual({...original.groups[0],bounds:{...original.groups[0].bounds!,x:-660}});
    expect(autoLayout(result,[],height)).toEqual(result);
  });
  it('clears overlaps between loose clips around the entry',()=>{
    const original=graph(Array.from({length:18},(_,i)=>clip(`clip-${i}`,1+i%7)));
    original.entryId='clip-4';
    const result=autoLayout(original,[]);
    expect(result.nodes[4]).toEqual({...original.nodes[4],x:40,y:90});expect(result.entryId).toBe(original.entryId);
    expect(result.nodes.map(({x,y,...n})=>n)).toEqual(original.nodes.map(({x,y,...n})=>n));
    expectNoOverlap(result);expect(autoLayout(result,[])).toEqual(result);
  });
  it('leaves an unconnected member of a connected group in place',()=>{
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:328,y:90},{...clip('loose'),x:1600,y:800}]);
    original.edges=[edge('start','end')];
    original.groups=[{id:'group',name:'Mixed',nodeIds:original.nodes.map(n=>n.id),color:'blue'}];
    const result=autoLayout(original,[]);
    expect(result.nodes[2]).toEqual(original.nodes[2]);expect(result.groups).toEqual(original.groups);expectNoOverlap(result);
  });
  it('keeps branches, merging inputs, cycles, isolated clips and grouped members separate',()=>{
    const original=graph(Array.from({length:16},(_,i)=>({...clip(`clip-${i}`,2+i%5),x:i<11?0:4000,y:i<11?0:1000+i*120})));
    original.edges=[edge('clip-0','clip-2'),edge('clip-1','clip-2'),...Array.from({length:6},(_,i)=>edge('clip-2',`clip-${i+3}`)),edge('clip-9','clip-10'),edge('clip-10','clip-9')];
    original.groups=[{id:'group',name:'Loose footage',nodeIds:['clip-11','clip-13','clip-15'],color:'blue'}];
    const result=autoLayout(original,[],320);
    expectFittedWithoutOverlap(result,[],320,1000,false);expect(result.edges).toEqual(original.edges);expect(result.groups).toBe(original.groups);
    expectNoOverlap(result);expect(autoLayout(result,[],320)).toEqual(result);
  });
  it.each([180,280,480])('stacks conditional destinations in one column at %ipx, even inside a template',height=>{
    const {node,item}=createNode('conditional'),outputs=[clip('yes',3),clip('no',8),clip('maybe',5)];
    const original=graph([node,...outputs,...Array.from({length:8},(_,i)=>({...clip(`loose-${i}`),x:-300,y:-200+i*100}))]);
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
    expectNoOverlap(result,[ready]);
    expect(result.edges[0]).toEqual({...original.edges[0],points:undefined});
    expect(result.nodes.map(({x,y,...n})=>n)).toEqual(original.nodes.map(({x,y,...n})=>n));
  });
  it('handles empty projects and self-loops',()=>{
    const empty=graph([]);expect(autoLayout(empty,[])).toBe(empty);
    const loop=graph([{...clip('loop'),x:-300,y:580}]);loop.edges=[{...edge('loop','loop'),points:[{id:'bend',x:400,y:20}]}];
    const result=autoLayout(loop,[]);
    expect(result.nodes[0]).toEqual({...loop.nodes[0],x:40,y:90});
    expect(result.edges[0].points).toEqual([{id:'bend',x:740,y:-470}]);
    expect(autoLayout(result,[])).toEqual(result);
  });
  it('moves self-loop bends with a displaced loose clip',()=>{
    const original=graph([{...clip('start'),x:40,y:90},{...clip('end'),x:272,y:90},{...clip('loop'),x:100,y:100}]);
    original.edges=[edge('start','end'),{...edge('loop','loop'),points:[{id:'bend',x:400,y:20}]}];
    const result=autoLayout(original,[]);
    expect(result.nodes[2]).toMatchObject({x:100,y:190});expect(result.edges[1].points).toEqual([{id:'bend',x:400,y:110}]);
    expect(autoLayout(result,[])).toEqual(result);
  });
});
