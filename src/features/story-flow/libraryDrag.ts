import type { DragEvent } from 'react';

export const STORY_DRAG_TYPE='application/x-sparko-clip';
export const LIBRARY_MOVE_TYPE='application/x-sparko-library-items';
export type LibraryMoveSelection={type:'asset'|'generation';id:string};
export type LibraryItem={mediaKind:'image'|'video'|'audio'}|{kind:'simple'|'looped'|'conditional'}|{templateId:string}|{assetId:string;generationId?:string}|{generationId:string;assetId?:string};

// Load an actual transparent bitmap before dragging. An unpainted canvas can
// leave the browser using its default snapshot of the source button instead.
const emptyDragImage=new Image(1,1);
emptyDragImage.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function readLibraryDrag(data:DataTransfer):LibraryItem|null {
  try {
    const value=JSON.parse(data.getData(STORY_DRAG_TYPE));
    if(!value||typeof value!=='object')return null;
    if(['image','video','audio'].includes(value.mediaKind))return {mediaKind:value.mediaKind};
    if(typeof value.generationId==='string')return {generationId:value.generationId,...(typeof value.assetId==='string'?{assetId:value.assetId}:{})};
    if(typeof value.assetId==='string')return {assetId:value.assetId};
    if(typeof value.templateId==='string')return {templateId:value.templateId};
    if(['simple','looped','conditional'].includes(value.kind))return {kind:value.kind};
  }catch{/* Other drags and protected dragover data have no readable payload. */}
  return null;
}

export function readLibraryMove(data:DataTransfer):LibraryMoveSelection[] {
  try {
    const items:unknown=JSON.parse(data.getData(LIBRARY_MOVE_TYPE));
    if(Array.isArray(items)&&items.every(item=>item&&['asset','generation'].includes(item.type)&&typeof item.id==='string'))return items;
  }catch{/* Other drags have no library selection. */}
  const item=readLibraryDrag(data);
  if(item&&'generationId' in item&&item.generationId)return [{type:'generation',id:item.generationId}];
  return item&&'assetId' in item&&item.assetId?[{type:'asset',id:item.assetId}]:[];
}

export function showLibraryDragImage(event:DragEvent,count=1,thumbnails:readonly Element[]=[]) {
  const visibleCount=Math.min(4,count),offset=8,padding=6;
  const preview=document.createElement('div');
  preview.className='library-drag-preview';preview.setAttribute('aria-hidden','true');
  preview.style.width=`${80+(visibleCount-1)*offset+padding*2}px`;
  preview.style.height=`${48+(visibleCount-1)*offset+padding*2}px`;
  const source=event.currentTarget.querySelector('.library-thumb,.image-reference-thumb')??event.currentTarget.querySelector('.lucide-folder,svg');
  for(let i=0;i<visibleCount;i++){
    const thumbnail=document.createElement('div');thumbnail.className='library-drag-thumbnail';
    thumbnail.style.left=thumbnail.style.top=`${padding+i*offset}px`;thumbnail.style.zIndex=String(visibleCount-i);
    const content=thumbnails[i]??source;if(content)thumbnail.append(content.cloneNode(true));
    preview.append(thumbnail);
  }
  if(count>1){const badge=document.createElement('span');badge.className='library-drag-count';badge.textContent=String(count);preview.append(badge);}
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview,preview.offsetWidth/2,preview.offsetHeight/2);
  requestAnimationFrame(()=>preview.remove());
}

export function startLibraryDrag(event:DragEvent,payload:LibraryItem,selection?:LibraryMoveSelection[],thumbnails?:readonly Element[]) {
  const media='assetId' in payload||'generationId' in payload;
  const items=selection??('generationId' in payload&&payload.generationId?[{type:'generation' as const,id:payload.generationId}]:
    'assetId' in payload&&payload.assetId?[{type:'asset' as const,id:payload.assetId}]:[]);
  event.dataTransfer.effectAllowed=items.length>1?'copyMove':media?'copyMove':'copy';
  // Multi-selection can move within Library or copy into reference inputs. Timeline placement uses one item.
  if(items.length<=1)event.dataTransfer.setData(STORY_DRAG_TYPE,JSON.stringify(payload));
  if(media){event.dataTransfer.setData(LIBRARY_MOVE_TYPE,JSON.stringify(items));showLibraryDragImage(event,items.length,thumbnails);}
  // Template and clip placement already draws a zoomed preview in the timeline.
  else event.dataTransfer.setDragImage(emptyDragImage,0,0);
}
