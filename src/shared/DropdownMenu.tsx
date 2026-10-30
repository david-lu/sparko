import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type RefObject } from 'react';

let dismissActiveMenu: (() => void) | undefined;

/** Dropdowns and portaled context menus share a single active menu. */
export function useExclusiveMenu<T extends HTMLElement>(element:RefObject<T|null>,open:boolean,onClose:()=>void,onEscape?:()=>void) {
  const callbacks=useRef({onClose,onEscape});callbacks.current={onClose,onEscape};
  useLayoutEffect(()=>{
    if(!open)return;
    const dismiss=()=>callbacks.current.onClose();
    dismissActiveMenu?.();dismissActiveMenu=dismiss;
    const outside=(event:Event)=>{if(event.target instanceof Node&&!element.current?.contains(event.target))dismiss();};
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();dismiss();callbacks.current.onEscape?.();
    };
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside,true);
    document.addEventListener('contextmenu',outside,true);
    document.addEventListener('keydown',escape,true);
    return()=>{
      if(dismissActiveMenu===dismiss)dismissActiveMenu=undefined;
      document.removeEventListener('pointerdown',outside,true);
      document.removeEventListener('focusin',outside,true);
      document.removeEventListener('contextmenu',outside,true);
      document.removeEventListener('keydown',escape,true);
    };
  },[element,open]);
}

const DropdownMenu=forwardRef<HTMLDetailsElement,ComponentPropsWithoutRef<'details'>>(function DropdownMenu({onToggle,...props},forwardedRef){
  const element=useRef<HTMLDetailsElement>(null),[open,setOpen]=useState(false);
  useImperativeHandle(forwardedRef,()=>element.current!,[]);
  useExclusiveMenu(element,open,()=>{if(element.current)element.current.open=false;},()=>element.current?.querySelector('summary')?.focus({preventScroll:true}));
  useLayoutEffect(()=>{
    if(!open)return;
    const menu=element.current!,surface=menu.querySelector<HTMLElement>(':scope > div');
    if(!surface)return;
    // Keep the CSS-defined anchor/width, but escape panel overflow clipping.
    // The popup stays in the details element for focus, dismissal and dragging;
    // its menu layer is shared with the other dropdowns and context menus.
    const bounds=surface.getBoundingClientRect();
    const previous=surface.getAttribute('style');
    Object.assign(surface.style,{
      position:'fixed',margin:'0',
      left:`${Math.max(8,Math.min(bounds.left,window.innerWidth-bounds.width-8))}px`,
      top:`${Math.max(8,Math.min(bounds.top,window.innerHeight-bounds.height-8))}px`,
    });
    const dismiss=()=>{menu.open=false;};
    const scroll=(event:Event)=>{if(event.target instanceof Node&&!surface.contains(event.target))dismiss();};
    window.addEventListener('resize',dismiss);
    window.addEventListener('scroll',scroll,true);
    return()=>{
      window.removeEventListener('resize',dismiss);
      window.removeEventListener('scroll',scroll,true);
      if(previous===null)surface.removeAttribute('style');else surface.setAttribute('style',previous);
    };
  },[open]);
  return <details {...props} ref={element} name="sparko-menu" data-popup-menu onToggle={event=>{setOpen(event.currentTarget.open);onToggle?.(event);}}/>;
});
export default DropdownMenu;
