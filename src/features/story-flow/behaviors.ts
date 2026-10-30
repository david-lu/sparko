import type { StoryGraph, StoryNode, StoryCondition } from './model';

/** Legacy kinds are read as defaults; new clips store independent behaviors. */
export const behaviors = (node: StoryNode) => ({
  loop: node.loop ?? (node.kind === 'looped' || node.kind === 'conditional'),
  conditional: node.conditional ?? node.kind === 'conditional',
});
export function conditionsFor(graph: Pick<StoryGraph,'edges'>,node:StoryNode):StoryCondition[]{
  const conditions=[...(node.conditions??[])];
  for(const edge of graph.edges.filter(e=>e.from===node.id&&e.event==='answer')){
    const id=edge.conditionId??edge.id;
    if(!conditions.some(c=>c.id===id))conditions.push({id,label:edge.label,values:edge.values});
  }
  return conditions;
}
export const defaultCondition=(graph:Pick<StoryGraph,'edges'>,node:StoryNode)=>{
  const conditions=conditionsFor(graph,node);return conditions.find(c=>c.id===node.defaultConditionId)??conditions[0];
};
/** Upgrade saved fallback wires to a default on an existing condition. */
export function normalizeConditions<T extends Pick<StoryGraph,'nodes'|'edges'>>(graph:T):T{
  let edges=[...graph.edges];
  const nodes=graph.nodes.map(node=>{
    if(!behaviors(node).conditional)return node;
    const conditions=conditionsFor(graph,node);let defaultId=node.defaultConditionId;
    for(const legacy of graph.edges.filter(e=>e.from===node.id&&e.event!=='answer')){
      if(legacy.to===node.id){edges=edges.filter(e=>e.id!==legacy.id);continue;}
      const existing=edges.find(e=>e.from===node.id&&e.event==='answer'&&e.to===legacy.to);
      let condition=conditions.find(c=>c.id===(existing?.conditionId??existing?.id))??conditions.find(c=>!edges.some(e=>e.from===node.id&&e.event==='answer'&&(e.conditionId??e.id)===c.id));
      if(!condition){condition={id:legacy.id,label:`Condition ${conditions.length+1}`,values:[]};conditions.push(condition);}
      defaultId??=condition.id;
      edges=edges.flatMap(e=>e.id!==legacy.id?[e]:existing?[]:[{...e,event:'answer',conditionId:condition.id,label:condition.label,values:condition.values}]);
    }
    return {...node,conditions,defaultConditionId:conditions.some(c=>c.id===defaultId)?defaultId:conditions[0]?.id};
  });
  return {...graph,nodes,edges};
}
export const behaviorLabel = (node: StoryNode) => {
  const value = behaviors(node);
  return [value.loop && 'Loop', value.conditional && 'Conditional'].filter(Boolean).join(' · ') || (node.source ? 'Source' : 'Interstitial');
};
export function setBehavior(graph: StoryGraph, id: string, behavior: 'loop' | 'conditional', enabled: boolean): StoryGraph {
  return normalizeConditions({ ...graph, nodes: graph.nodes.map(node => {
    if (node.id !== id) return node;
    let conditions = conditionsFor(graph, node);
    if (behavior === 'conditional' && enabled && !conditions.length) conditions = [1, 2].map(n => ({ id: crypto.randomUUID(), label: `Condition ${n}`, values: [] }));
    return { ...node, ...behaviors(node), [behavior]: enabled, conditions };
  }) });
}

export type OutputPort = { id: string; label: string; conditionId?: string; isDefault?: boolean; edgeId?: string };
export function outputPorts(graph: Pick<StoryGraph, 'edges'>, node: StoryNode): OutputPort[] {
  const edges = graph.edges.filter(e => e.from === node.id);
  if (!behaviors(node).conditional) return [{ id: 'next', label: 'Next', edgeId: edges.find(e => e.event === 'next')?.id }];
  return conditionsFor(graph, node).map(c => ({ id: c.id, conditionId: c.id, label: c.label,isDefault:defaultCondition(graph,node)?.id===c.id,
    edgeId: edges.find(e => e.event === 'answer' && (e.conditionId ?? e.id) === c.id)?.id }));
}
export const outputOffset = (count: number, index: number) => 48 + (index - (count - 1) / 2) * 22;
