import { z } from 'zod';
const id=z.string().min(1).max(200), text=z.string().max(8000), seconds=z.number().finite().min(0).max(1e8);
export const storyNodeSchema=z.object({id,name:z.string().max(1000),kind:z.enum(['source','simple','looped','conditional']),
  x:z.number().finite(),y:z.number().finite(),
  source:z.object({assetId:z.uuid(),originalAssetId:z.uuid().optional(),duration:z.number().finite().positive().optional(),inFrame:z.number().int().min(0),outFrame:z.number().int().positive()}).refine(s=>s.outFrame>s.inFrame).optional(),
  trim:z.object({inFrame:z.number().int().min(0),outFrame:z.number().int().positive()}).refine(s=>s.outFrame>s.inFrame).optional(),
  interstitialId:id.optional(),referenceId:id.optional(),crossfadeStart:seconds.optional(),crossfadeEnd:seconds.optional(),loopCount:z.number().int().min(0).max(10000)
}).refine(n=>n.kind==='source'?!!n.source:!!n.interstitialId,'A clip is missing its media reference.');
export const storyEdgeSchema=z.object({id,from:id,to:id,event:z.enum(['next','answer','fallback']),label:z.string().max(200),values:z.array(z.string().max(200)).max(100),crossfade:seconds.optional(),points:z.array(z.object({id,x:z.number().finite(),y:z.number().finite()})).max(200).optional()});
const templateSettings=z.object({method:z.enum(['comfy','comfy-extend','comfy-loop']).optional(),start_range:seconds.max(4),end_range:seconds.max(4),duration:seconds.min(1).max(13),prompt:text,enable_prompt_expansion:z.boolean(),continuity:text.optional(),dialogue:text.optional(),loopAudio:z.boolean().optional(),maskInjection:z.enum(['standard','uniform','vignette']).optional()});
const structure={entryId:id,nodes:z.array(storyNodeSchema).min(1).max(1000),edges:z.array(storyEdgeSchema).max(5000)};
function valid(value:{entryId:string;nodes:z.infer<typeof storyNodeSchema>[];edges:z.infer<typeof storyEdgeSchema>[]}){
  const ids=new Set(value.nodes.map(n=>n.id));
  return ids.size===value.nodes.length&&ids.has(value.entryId)&&new Set(value.edges.map(e=>e.id)).size===value.edges.length
    &&value.edges.every(e=>ids.has(e.from)&&ids.has(e.to))&&value.nodes.every(n=>!n.referenceId||ids.has(n.referenceId))
    &&value.nodes.every(n=>value.edges.filter(e=>e.from===n.id&&e.event==='next').length<=1&&value.edges.filter(e=>e.from===n.id&&e.event==='fallback').length<=1);
}
export const storyTemplateSchema=z.object({id,name:z.string().min(1).max(200),...structure,settings:z.record(id,templateSettings)})
  .refine(valid,'Invalid template connections.').refine(t=>t.nodes.every(n=>n.kind!=='source'&&!!t.settings[n.id]),'Templates contain interstitial settings only.');
export const storyGraphSchema=z.object({version:z.literal(1),...structure,templates:z.array(storyTemplateSchema).max(100)}).refine(valid,'Invalid story connections.');
