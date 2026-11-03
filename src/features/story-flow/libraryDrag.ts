import type { DragEvent } from 'react';

export const STORY_DRAG_TYPE='application/x-sparko-clip';
export type LibraryItem={kind:'simple'|'looped'|'conditional'}|{templateId:string}|{assetId:string;generationId?:string}|{generationId:string;assetId?:string};

// Load an actual transparent bitmap before dragging. An unpainted canvas can
// leave the browser using its default snapshot of the source button instead.
const emptyDragImage=new Image(1,1);
emptyDragImage.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function readLibraryDrag(data:DataTransfer):LibraryItem|null {
  try {
    const value=JSON.parse(data.getData(STORY_DRAG_TYPE));
    if(!value||typeof value!=='object')return null;
    if(typeof value.generationId==='string')return {generationId:value.generationId,...(typeof value.assetId==='string'?{assetId:value.assetId}:{})};
    if(typeof value.assetId==='string')return {assetId:value.assetId};
    if(typeof value.templateId==='string')return {templateId:value.templateId};
    if(['simple','looped','conditional'].includes(value.kind))return {kind:value.kind};
  }catch{/* Other drags and protected dragover data have no readable payload. */}
  return null;
}

export function startLibraryDrag(event:DragEvent,payload:LibraryItem) {
  event.dataTransfer.effectAllowed='copy';
  event.dataTransfer.setData(STORY_DRAG_TYPE,JSON.stringify(payload));
  // The timeline draws the actual clip/group at the pointer, at the current zoom.
  event.dataTransfer.setDragImage(emptyDragImage,0,0);
}
