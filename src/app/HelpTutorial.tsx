import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, X } from 'lucide-react';
import ModalBackdrop from '../shared/ModalBackdrop';
import { shortcutActions, useShortcuts, type ShortcutId } from '../shared/shortcuts';
import { HelpPicture, HelpPictureViewer, type HelpPictureId } from './tutorial/HelpPicture';
import './help.css';

const topics = [
  { id: 'start', title: 'Quick start' },
  { id: 'timeline', title: 'Timeline & connections' },
  { id: 'generate', title: 'Generate a video' },
  { id: 'templates', title: 'Reuse templates' },
  { id: 'workspace', title: 'Workspace & shortcuts' },
] as const;
type Topic = typeof topics[number]['id'];
const steps: { title: string; text: string; picture: HelpPictureId }[] = [
  { title: 'What are we adding?', text: 'An interstitial is a new scene that plays between two parts of your video.', picture: 'overview' },
  { title: 'Import your video', text: 'Click the upload button in Library. Choose your video.', picture: 'import' },
  { title: 'Pick the moment', text: 'Click the images inside your clip. The vertical line, called the playhead, moves to that moment.', picture: 'playhead' },
  { title: 'Cut your video into two pieces', text: 'Right-click the clip → Cut at playhead. Both pieces keep their footage.', picture: 'cut' },
  { title: 'Find the Interstitial card', text: 'Open Add clips. Find the card labeled Interstitial.', picture: 'add' },
  { title: 'Drop it between the pieces', text: 'Drag the Interstitial card onto the connecting line, then release.', picture: 'drop' },
  { title: 'Check the clips on either side', text: 'Select your new scene. In Inspector, turn on Start and End to match the first and second pieces.', picture: 'references' },
  { title: 'Describe your new scene', text: 'Write what should happen. Set Duration to how many seconds it should last.', picture: 'generate' },
  { title: 'Make the video', text: 'Click Generate. Wait for it to finish, then open Generated video to preview it.', picture: 'generate' },
  { title: 'Play and save', text: 'Play from the first clip. Then choose File → Save project.', picture: 'save' },
];
const usefulShortcuts: ShortcutId[] = ['play', 'fit', 'layout', 'add', 'split', 'group', 'undo', 'redo'];

export default function HelpTutorial({onClose}:{onClose:()=>void}) {
  const [topic,setTopic]=useState<Topic>('start'),[step,setStep]=useState(0);
  const [picture,setPicture]=useState<HelpPictureId|null>(null);
  const pictureTrigger=useRef<HTMLButtonElement|null>(null),stepContent=useRef<HTMLDivElement|null>(null);
  const showPicture=(id:HelpPictureId,trigger:HTMLButtonElement)=>{pictureTrigger.current=trigger;setPicture(id);};
  const illustration=(id:HelpPictureId)=><HelpPicture id={id} onOpen={showPicture}/>;
  const keys=useShortcuts(),current=topics.find(item=>item.id===topic)!,activeStep=steps[step];
  const changeStep=(value:number)=>{setStep(value);stepContent.current?.scrollTo({top:0});};
  return <><ModalBackdrop labelledBy="help-title" onCancel={onClose} restoreFocus={()=>document.querySelector<HTMLElement>('.window-menu>summary')?.focus({preventScroll:true})}>
    <section className="help-page" onKeyDown={event=>event.stopPropagation()}>
      <header className="help-header"><BookOpen size={21} aria-hidden/><div><h1 id="help-title">Help & tutorial</h1><p>Follow the pictures. One step at a time.</p></div>
        <button autoFocus className="icon-button" aria-label="Close help" onClick={onClose}><X size={20}/></button>
      </header>
      <div className="help-body">
        <nav className="help-topics" aria-label="Tutorial topics">{topics.map((item,index)=><button key={item.id} aria-current={topic===item.id?'page':undefined} onClick={()=>setTopic(item.id)} aria-controls="help-article"><span aria-hidden>{String(index+1).padStart(2,'0')}</span>{item.title}</button>)}</nav>
        <article className={`help-article ${topic==='start'?'is-walkthrough':''}`} id="help-article" key={topic} aria-labelledby="help-topic-title" tabIndex={0}>
          <h2 id="help-topic-title">{current.title}</h2>
          {topic==='start'&&<div className="help-walkthrough">
            <div className="help-step-copy" aria-live="polite" aria-atomic="true"><p className="help-step-count">Step {step+1} of {steps.length}</p><h3>{activeStep.title}</h3><p>{activeStep.text}</p></div>
            <div className="help-step-content" ref={stepContent}>
              <HelpPicture id={activeStep.picture} onOpen={showPicture} caption={false}/>
            </div>
            <nav className="help-step-navigation" aria-label="Walkthrough steps">
              <button className="button small" disabled={step===0} onClick={()=>changeStep(step-1)}><ArrowLeft size={15} aria-hidden/>Back</button>
              {step===steps.length-1?<button className="button primary small" onClick={()=>changeStep(0)}>Start again</button>:<button className="button primary small" onClick={()=>changeStep(step+1)}>Next<ArrowRight size={15} aria-hidden/></button>}
            </nav>
          </div>}
          {topic==='timeline'&&<>
            <h3>Cut = split into two pieces</h3><p>Move the playhead. Right-click the clip → <strong>Cut at playhead</strong>. Use Undo if you cut in the wrong place.</p>
            {illustration('cut')}
            <h3>Connect clips</h3><p>Drag an output circle to the next clip’s input circle. The arrows decide what plays next.</p>
            {illustration('inserted')}
            <h3>Move around</h3><ul className="help-tips"><li><strong>Space + drag:</strong> move around the timeline.</li><li><strong>Pinch:</strong> zoom in or out.</li><li><strong>Fit:</strong> bring your clips into view.</li></ul>
          </>}
          {topic==='generate'&&<>
            <p>Select an interstitial, then open <strong>Inspector</strong>.</p>
            {illustration('generate')}
            <h3>Start and End</h3><p><strong>Start</strong> matches the previous clip. <strong>End</strong> matches the next clip.</p>
            {illustration('references')}
            <div className="help-note">Generate disabled? Read the message under the button.</div>
          </>}
          {topic==='templates'&&<>
            <p>Templates add a ready-made set of clips. Drag one onto the timeline.</p>
            {illustration('templates')}
            <h3>Save your own</h3><p>Select clips → right-click → <strong>Save as template</strong>.</p><p>For a group, right-click its title → <strong>Save group as template</strong>.</p>
          </>}
          {topic==='workspace'&&<>
            <p>Use <strong>Window</strong> to show panels. Drag their titles to move them.</p>
            {illustration('workspace')}
            <h3>Lock your layout</h3><p>Choose <strong>Lock workspace</strong> to prevent panel changes.</p>
            <h3>Useful keys</h3><p>Change these in the <strong>Shortcuts</strong> menu.</p>
            <dl className="help-shortcuts">{usefulShortcuts.map(id=><div key={id}><dt>{shortcutActions.find(action=>action.id===id)!.label}</dt><dd><kbd>{keys.label(id)||'Unassigned'}</kbd></dd></div>)}</dl>
          </>}
        </article>
      </div>
      <footer className="help-footer"><span>Click a picture to enlarge it.</span><button className="button primary small" onClick={onClose}>Back to editor</button></footer>
    </section>
  </ModalBackdrop>{picture&&<HelpPictureViewer id={picture} onClose={()=>setPicture(null)} restoreFocus={()=>pictureTrigger.current?.focus({preventScroll:true})}/>}</>;
}
