import { useSyncExternalStore } from 'react';

export const shortcutActions = [
  { id: 'fit', label: 'Fit', group: 'Timeline', defaults: ['F'], description: 'Fit selected clips, or all clips when nothing is selected.' },
  { id: 'layout', label: 'Auto layout', group: 'Timeline', defaults: ['A'] },
  { id: 'select', label: 'Select tool', group: 'Timeline', defaults: ['V'] },
  { id: 'cut', label: 'Cut tool', group: 'Timeline', defaults: ['C'] },
  { id: 'pan', label: 'Hand tool', group: 'Timeline', defaults: ['H'] },
  { id: 'add', label: 'New interstitial', group: 'Timeline', defaults: ['N', 'P'] },
  { id: 'split', label: 'Split at playhead', group: 'Timeline', defaults: ['S'] },
  { id: 'duplicate', label: 'Duplicate selected clips', group: 'Timeline', defaults: ['Mod+D'] },
  { id: 'delete', label: 'Delete selection', group: 'Timeline', defaults: ['Delete', 'Backspace'] },
  { id: 'group', label: 'Group selected clips', group: 'Timeline', defaults: ['Mod+G'] },
  { id: 'ungroup', label: 'Ungroup clips', group: 'Timeline', defaults: ['Mod+Shift+G'] },
  { id: 'undo', label: 'Undo', group: 'Editing', defaults: ['Mod+Z'] },
  { id: 'redo', label: 'Redo', group: 'Editing', defaults: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'play', label: 'Play / pause', group: 'Playback', defaults: ['Space', 'K'] },
  { id: 'back5', label: 'Seek back 5 seconds', group: 'Playback', defaults: ['ArrowLeft'] },
  { id: 'forward5', label: 'Seek forward 5 seconds', group: 'Playback', defaults: ['ArrowRight'] },
  { id: 'back10', label: 'Seek back 10 seconds', group: 'Playback', defaults: ['J'] },
  { id: 'forward10', label: 'Seek forward 10 seconds', group: 'Playback', defaults: ['L'] },
  { id: 'previousFrame', label: 'Previous frame', group: 'Playback', defaults: ['Comma'] },
  { id: 'nextFrame', label: 'Next frame', group: 'Playback', defaults: ['Period'] },
  { id: 'volumeUp', label: 'Volume up', group: 'Playback', defaults: ['ArrowUp'] },
  { id: 'volumeDown', label: 'Volume down', group: 'Playback', defaults: ['ArrowDown'] },
  { id: 'mute', label: 'Mute', group: 'Playback', defaults: ['M'] },
  { id: 'fullscreen', label: 'Fullscreen', group: 'Playback', defaults: [] },
  { id: 'captions', label: 'Toggle captions', group: 'Playback', defaults: ['Shift+C'] },
  { id: 'start', label: 'Go to start', group: 'Playback', defaults: ['Home', '0'] },
  { id: 'end', label: 'Go to end', group: 'Playback', defaults: ['End'] },
  ...([1,2,3,4,5,6,7,8,9] as const).map(n => ({ id: `jump${n}` as const, label: `Jump to ${n*10}%`, group: 'Playback', defaults: [String(n)] })),
] as const;
export type ShortcutId = typeof shortcutActions[number]['id'];
export type ShortcutBindings = Record<ShortcutId, string[]>;
export const defaultBindings = (): ShortcutBindings => Object.fromEntries(shortcutActions.map(a => [a.id, [...a.defaults]])) as ShortcutBindings;
const keyNames = new Set(['Space','Comma','Period','Slash','Backslash','Semicolon','Quote','BracketLeft','BracketRight','Minus','Equal','Backquote','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Delete','Backspace','Enter',...Array.from({length:12},(_,i)=>`F${i+1}`)]);
export const validShortcut = (value: unknown): value is string => typeof value === 'string' && /^(Mod\+)?(Alt\+)?(Shift\+)?[^+]+$/.test(value) && (/^[A-Z0-9]$/.test(value.split('+').at(-1)!) || keyNames.has(value.split('+').at(-1)!));
type KeyEvent = Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>;
export function shortcutFromEvent(event: KeyEvent): string | null {
  const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/,'') : keyNames.has(event.code) ? event.code : event.key.length===1&&/[a-z0-9]/i.test(event.key) ? event.key.toUpperCase() : event.key===' ' ? 'Space' : event.key;
  const value = `${event.ctrlKey||event.metaKey?'Mod+':''}${event.altKey?'Alt+':''}${event.shiftKey?'Shift+':''}${key}`;
  return validShortcut(value) ? value : null;
}
export function shortcutAction(bindings: ShortcutBindings, event: KeyEvent): ShortcutId | undefined {
  const key = shortcutFromEvent(event);
  return key ? shortcutActions.find(a=>bindings[a.id].includes(key))?.id : undefined;
}
export function shortcutConflict(bindings: ShortcutBindings, key: string, id: ShortcutId, slot: number) {
  return shortcutActions.find(a=>bindings[a.id].some((binding,index)=>binding===key&&(a.id!==id||index!==slot)));
}
export function restoreBindings(value: unknown): ShortcutBindings {
  const bindings=defaultBindings();
  if(!value||typeof value!=='object')return bindings;
  for(const action of shortcutActions){const saved=(value as Record<string,unknown>)[action.id];
    if(Array.isArray(saved)&&saved.length<=2&&saved.every(k=>k===''||validShortcut(k)))bindings[action.id]=saved;
  }
  const used=new Set<string>();
  for(const action of shortcutActions)bindings[action.id]=bindings[action.id].map(key=>{if(!key||used.has(key))return '';used.add(key);return key;});
  return bindings;
}
const storageKey='sparko:shortcuts';
function readBindings(){try{return restoreBindings(JSON.parse(localStorage.getItem(storageKey)??'null'));}catch{return defaultBindings();}}
let current=readBindings();
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
const onStorage=(event:StorageEvent)=>{if(event.key===storageKey||event.key===null){current=readBindings();notify();}};
function subscribe(listener:()=>void){if(!listeners.size)window.addEventListener('storage',onStorage);listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size)window.removeEventListener('storage',onStorage);};}
export function saveBindings(bindings:ShortcutBindings){current=bindings;try{localStorage.setItem(storageKey,JSON.stringify(bindings));}catch{/* Keep shortcuts for this session. */}notify();}
export function formatShortcut(key:string){return key.split('+').map(part=>({Mod:'Ctrl/Cmd',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Comma:',',Period:'.',Slash:'/',Backslash:'\\',Semicolon:';',Quote:"'",BracketLeft:'[',BracketRight:']',Minus:'−',Equal:'=',Backquote:'`'} as Record<string,string>)[part]??part).join('+');}
export function useShortcuts(){
  const bindings=useSyncExternalStore(subscribe,()=>current);
  const label=(id:ShortcutId)=>bindings[id].filter(Boolean).map(formatShortcut).join(' / ');
  const title=(id:ShortcutId,text=shortcutActions.find(a=>a.id===id)!.label)=>`${text}${label(id)?` (${label(id)})`:''}`;
  const aria=(id:ShortcutId)=>bindings[id].filter(Boolean).flatMap(key=>key.includes('Mod')?[key.replace('Mod','Control'),key.replace('Mod','Meta')]:[key]).join(' ')||undefined;
  return {bindings,label,title,aria,action:(event:KeyEvent)=>shortcutAction(bindings,event)};
}
