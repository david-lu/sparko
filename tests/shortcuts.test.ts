import { describe, expect, it } from 'vitest';
import { defaultBindings, formatShortcut, restoreBindings, shortcutAction, shortcutConflict, shortcutFromEvent } from '../src/shared/shortcuts';

const key=(code:string,modifiers:Partial<KeyboardEvent>={})=>({code,key:code.replace('Key','').toLowerCase(),ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...modifiers});
describe('shortcut assignments',()=>{
  it('uses F only for Fit and keeps every default binding unique',()=>{
    const bindings=defaultBindings(),keys=Object.values(bindings).flat();expect(new Set(keys).size).toBe(keys.length);
    expect(shortcutAction(bindings,key('KeyF'))).toBe('fit');expect(bindings.fullscreen).toEqual([]);
    expect(shortcutAction(bindings,key('KeyF',{shiftKey:true}))).toBeUndefined();
  });
  it('matches exact modifiers with equivalent Control and Command bindings',()=>{
    expect(shortcutAction(defaultBindings(),key('KeyZ',{ctrlKey:true}))).toBe('undo');
    expect(shortcutAction(defaultBindings(),key('KeyZ',{metaKey:true,shiftKey:true}))).toBe('redo');
    expect(shortcutAction(defaultBindings(),key('KeyZ',{ctrlKey:true,altKey:true}))).toBeUndefined();
    expect(shortcutFromEvent(key('KeyQ',{altKey:true,shiftKey:true}))).toBe('Alt+Shift+Q');
  });
  it('accepts punctuation and function keys but reserves navigation out of the recorder',()=>{
    expect(shortcutFromEvent(key('Comma',{key:','}))).toBe('Comma');expect(formatShortcut('Mod+Shift+Comma')).toBe('Ctrl/Cmd+Shift+,');
    expect(shortcutFromEvent(key('F8'))).toBe('F8');
    for(const code of ['Tab','Escape','ShiftLeft','ControlLeft','Dead'])expect(shortcutFromEvent(key(code))).toBeNull();
  });
  it('checks conflicts across commands and alternate assignments',()=>{
    const bindings=defaultBindings();expect(shortcutConflict(bindings,'C','fit',0)?.id).toBe('cut');
    expect(shortcutConflict(bindings,'K','fit',1)?.id).toBe('play');expect(shortcutConflict(bindings,'F','fit',0)).toBeUndefined();
    bindings.cut=[];expect(shortcutConflict(bindings,'C','fit',0)).toBeUndefined();
  });
  it('restores remapped, empty and alternate bindings without resurrecting defaults',()=>{
    const bindings=defaultBindings();bindings.fit=['Alt+Q','Shift+F'];bindings.fullscreen=['F8'];bindings.play=['','K'];bindings.cut=[];
    const restored=restoreBindings(JSON.parse(JSON.stringify(bindings)));expect(restored).toEqual(bindings);
    expect(shortcutAction(restored,key('KeyF'))).toBeUndefined();expect(shortcutAction(restored,key('KeyQ',{altKey:true}))).toBe('fit');
  });
  it('rejects malformed preferences and resolves duplicate saved assignments',()=>{
    expect(restoreBindings(null)).toEqual(defaultBindings());
    const bindings=restoreBindings({fit:['Escape'],cut:[false],play:['K','K'],fullscreen:['F'],unknown:['Q']});
    expect(bindings.fit).toEqual(['F']);expect(bindings.cut).toEqual(['C']);expect(bindings.play).toEqual(['K','']);expect(bindings.fullscreen).toEqual(['']);
  });
});
