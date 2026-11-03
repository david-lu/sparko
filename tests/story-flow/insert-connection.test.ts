import { describe, it, expect } from 'vitest';
import { createNode, edge, type StoryGraph } from '../../src/features/story-flow/model';
import { insertIntoConnection } from '../../src/features/story-flow/insertIntoConnection';

const fixture=()=>{
  const nodes=['simple','conditional','simple','simple'].map(kind=>createNode(kind as 'simple'|'conditional').node);
  const connection={...edge(nodes[1].id,nodes[2].id,'answer','Yes'),conditionId:'yes',values:['yes'],crossfade:.4,points:[{id:'bend',x:100,y:100}]};
  const graph:StoryGraph={version:1,entryId:nodes[1].id,nodes,edges:[connection],templates:[],groups:[{id:'group',name:'Group',color:'blue',nodeIds:[nodes[0].id]}]};
  return {graph,node:nodes[0],connection};
};
describe('insert an existing video into a transition',()=>{
  it('keeps the node identity, group, settings link, and incoming branch metadata',()=>{
    const {graph,node,connection}=fixture(),next=insertIntoConnection(graph,node.id,connection.id);
    expect(next.nodes).toHaveLength(graph.nodes.length);expect(next.groups).toEqual(graph.groups);expect(next.entryId).toBe(graph.entryId);
    expect(next.nodes[0]).toEqual({...node,referenceId:connection.from});
    expect(next.edges[0]).toEqual({...connection,to:node.id,points:undefined,crossfade:undefined,crossfadeReferenceRatio:.75});
    expect(next.edges[1]).toMatchObject({from:node.id,to:connection.to,event:'next',crossfadeReferenceRatio:.75});
    expect(graph.edges).toEqual([connection]);
  });
  it('redirects the existing next output and retains unrelated incoming connections',()=>{
    const {graph,node,connection}=fixture();graph.edges.push(edge(node.id,graph.nodes[3].id),edge(graph.nodes[3].id,node.id));
    const next=insertIntoConnection(graph,node.id,connection.id);
    expect(next.edges.filter(e=>e.from===node.id)).toHaveLength(1);
    expect(next.edges.find(e=>e.from===node.id)?.to).toBe(connection.to);
    expect(next.edges).toContainEqual(graph.edges[2]);
  });
  it('preserves conditional branches and connects a new branch to the destination',()=>{
    const {graph,node,connection}=fixture();node.conditional=true;node.conditions=[{id:'existing',label:'Existing',values:[]}];
    const branch={...edge(node.id,graph.nodes[3].id,'answer'),conditionId:'existing'};graph.edges.push(branch);
    const next=insertIntoConnection(graph,node.id,connection.id);
    expect(next.edges).toContainEqual(branch);expect(next.edges.filter(e=>e.from===node.id)).toHaveLength(2);
    expect(next.edges.find(e=>e.from===node.id&&e.to===connection.to)?.event).toBe('answer');
  });
  it('reuses an existing destination connection',()=>{
    const {graph,node,connection}=fixture(),outgoing={...edge(node.id,connection.to),crossfade:.5};graph.edges.push(outgoing);
    expect(insertIntoConnection(graph,node.id,connection.id).edges).toEqual([{...connection,to:node.id,points:undefined,crossfade:undefined,crossfadeReferenceRatio:.75},outgoing]);
  });
  it('ignores source clips, missing targets, and connections already attached to the dragged clip',()=>{
    const {graph,node,connection}=fixture();
    expect(insertIntoConnection(graph,node.id,'missing')).toBe(graph);
    expect(insertIntoConnection(graph,connection.from,connection.id)).toBe(graph);
    expect(insertIntoConnection(graph,connection.to,connection.id)).toBe(graph);
    node.kind='source';expect(insertIntoConnection(graph,node.id,connection.id)).toBe(graph);
  });
});
