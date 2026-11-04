import { loraSettings } from '../../../shared/loras';
import { z } from 'zod';
import { videoReferenceSettings } from '../../../shared/video-references';
import { generationResolutions } from '../../../shared/interstitials';
import { MASK_TRANSITION } from '../../../shared/constants';
import { imageReferencesSchema, imageReferenceIndexSchema } from '../../../shared/image-references';
import { maskCurveSchema } from '../../../shared/mask-curves';
const id=z.string().min(1).max(200), text=z.string().max(8000), seconds=z.number().finite().min(0).max(1e8);
export const storyNodeSchema=z.object({id,name:z.string().max(1000),kind:z.enum(['source','simple','looped','conditional']),
  x:z.number().finite(),y:z.number().finite(),
  source:z.object({assetId:z.uuid(),originalAssetId:z.uuid().optional(),duration:z.number().finite().positive().optional(),inFrame:z.number().int().min(0),outFrame:z.number().int().positive()}).refine(s=>s.outFrame>s.inFrame).optional(),
  trim:z.object({inFrame:z.number().int().min(0),outFrame:z.number().int().positive()}).refine(s=>s.outFrame>s.inFrame).optional(),
  interstitialId:id.optional(),referenceId:id.optional(),crossfadeStart:seconds.optional(),crossfadeEnd:seconds.optional(),loopCount:z.number().int().min(0).max(10000),
  loop:z.boolean().optional(),conditional:z.boolean().optional(),defaultConditionId:id.optional(),conditions:z.array(z.object({id,label:z.string().max(200),values:z.array(z.string().max(200)).max(100)})).max(100).optional()
}).refine(n=>n.kind==='source'?!!n.source:!!n.interstitialId,'A clip is missing its media reference.');
export const storyEdgeSchema=z.object({id,from:id,to:id,event:z.enum(['next','answer','fallback']),conditionId:id.optional(),label:z.string().max(200),values:z.array(z.string().max(200)).max(100),crossfade:seconds.optional(),crossfadeReferenceRatio:z.number().finite().min(0).max(1).optional(),videoCrossfade:seconds.optional(),audioCrossfade:seconds.optional(),points:z.array(z.object({id,x:z.number().finite(),y:z.number().finite()})).max(200).optional()});
const templateSettings=z.object({...loraSettings,...videoReferenceSettings,audioMaskCurve:maskCurveSchema.optional(),videoMaskCurve:maskCurveSchema.optional(),imageReferences:imageReferencesSchema.optional(),startImageIndex:imageReferenceIndexSchema.optional(),endImageIndex:imageReferenceIndexSchema.optional(),startReferenceType:z.enum(['none','video','image']).optional(),endReferenceType:z.enum(['none','video','image']).optional(),resolution:z.enum(generationResolutions).optional(),useInputReference:z.boolean().optional(),useOutputReference:z.boolean().optional(),method:z.enum(['comfy','comfy-extend','comfy-loop']).optional(),start_range:seconds.max(4),end_range:seconds.max(4),duration:seconds.min(1).max(13),prompt:text,enable_prompt_expansion:z.boolean(),continuity:text.optional(),dialogue:text.optional(),loopAudio:z.boolean().optional(),maskInjection:z.enum(['standard','uniform','vignette']).optional(),audioMaskTransitionMs:z.number().int().min(0).max(MASK_TRANSITION.maxMs).optional(),videoMaskTransitionMs:z.number().int().min(0).max(MASK_TRANSITION.maxMs).optional(),maskTransitionMs:z.number().int().min(0).max(MASK_TRANSITION.maxMs).optional()});
const groupColor=z.enum(['blue','purple','green','amber','rose']);
export const storyGroupSchema=z.object({id,name:z.string().min(1).max(200),nodeIds:z.array(id).max(1000),color:groupColor,
  bounds:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().positive(),height:z.number().finite().positive()}).optional()
}).refine(g=>g.nodeIds.length>0||!!g.bounds,'An empty group needs a frame.');
const structure={entryId:id,nodes:z.array(storyNodeSchema).min(1).max(1000),edges:z.array(storyEdgeSchema).max(5000)};
function valid(value:{entryId:string;nodes:z.infer<typeof storyNodeSchema>[];edges:z.infer<typeof storyEdgeSchema>[]}){
  const ids=new Set(value.nodes.map(n=>n.id));
  return ids.size===value.nodes.length&&(value.nodes.length?ids.has(value.entryId):value.entryId==='')&&new Set(value.edges.map(e=>e.id)).size===value.edges.length
    &&value.edges.every(e=>ids.has(e.from)&&ids.has(e.to))&&value.nodes.every(n=>!n.referenceId||ids.has(n.referenceId))
    &&value.nodes.every(n=>value.edges.filter(e=>e.from===n.id&&e.event==='next').length<=1&&value.edges.filter(e=>e.from===n.id&&e.event==='fallback').length<=1)
    &&value.nodes.every(n=>!n.conditions||new Set(n.conditions.map(c=>c.id)).size===n.conditions.length)
    &&value.nodes.every(n=>!n.defaultConditionId||n.conditions?.some(c=>c.id===n.defaultConditionId))
    &&value.edges.every(e=>!e.conditionId||e.event==='answer'&&value.nodes.find(n=>n.id===e.from)?.conditions?.some(c=>c.id===e.conditionId))
    &&new Set(value.edges.filter(e=>e.conditionId).map(e=>JSON.stringify([e.from,e.conditionId]))).size===value.edges.filter(e=>e.conditionId).length;
}
export const storyTemplateSchema=z.object({id,name:z.string().min(1).max(200),...structure,color:groupColor.optional(),settings:z.record(id,templateSettings)})
  .refine(valid,'Invalid template connections.').refine(t=>t.nodes.every(n=>n.kind==='source'||!!t.settings[n.id]),'A template clip is missing its generation settings.');
export const storyGraphSchema=z.object({version:z.literal(1),...structure,entryId:z.string().max(200),nodes:z.array(storyNodeSchema).max(1000),templates:z.array(storyTemplateSchema).max(100),groups:z.array(storyGroupSchema).max(1000).optional()}).refine(valid,'Invalid story connections.')
  .refine(g=>{const groups=g.groups??[],members=groups.flatMap(group=>group.nodeIds);return new Set(groups.map(group=>group.id)).size===groups.length&&new Set(members).size===members.length&&members.every(id=>g.nodes.some(n=>n.id===id));},'Invalid group membership.');
