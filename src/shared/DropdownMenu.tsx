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
  return <details {...props} ref={element} name="sparko-menu" data-popup-menu onToggle={event=>{setOpen(event.currentTarget.open);onToggle?.(event);}}/>;
});
export default DropdownMenu;
