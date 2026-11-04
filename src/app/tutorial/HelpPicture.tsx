import { useState } from 'react';
import { Maximize2, X, ZoomIn } from 'lucide-react';
import ModalBackdrop from '../../shared/ModalBackdrop';
import dimensions from './images/dimensions.json';
import overviewImage from './images/overview.svg';
import importImage from './images/import.png';
import playheadImage from './images/playhead.png';
import cutImage from './images/cut.png';
import splitImage from './images/split.png';
import addImage from './images/add.png';
import dropImage from './images/drop.png';
import insertedImage from './images/inserted.png';
import referencesImage from './images/references.png';
import generateImage from './images/generate.png';
import saveImage from './images/save.png';
import templatesImage from './images/templates.png';
import workspaceImage from './images/workspace.png';

const pictures = {
  overview: { src: overviewImage, title: 'Where the new scene goes', caption: 'Your video plays, the new scene plays, then your video continues.', alt: 'Diagram with three boxes connected by downward arrows: Your video plays, Your new scene plays, Your video continues. The middle box is labeled Video.' },
  import: { src: importImage, title: 'Import your video', caption: 'Click the upload button in Library, then choose a video.', alt: 'Library screenshot with an arrow pointing to the Import assets upload button.' },
  playhead: { src: playheadImage, title: 'Choose the insertion point', caption: 'The vertical playhead marks where your new scene will begin.', alt: 'Timeline screenshot showing the playhead positioned inside an example video clip.' },
  cut: { src: cutImage, title: 'Cut at the playhead', caption: 'Right-click the clip and choose Cut at playhead.', alt: 'Clip right-click menu with Cut at playhead outlined and indicated by an arrow.' },
  split: { src: splitImage, title: 'One clip becomes two pieces', caption: 'A cut keeps both pieces of your video and connects them in order.', alt: 'Two video clips labeled First piece and Second piece, with the connecting transition highlighted between them.' },
  add: { src: addImage, title: 'Find the Video card', caption: 'This is the card to drag from the Add clips panel.', alt: 'Add clips panel with the Video card outlined and an arrow labeled Drag this card.' },
  drop: { src: dropImage, title: 'Drop onto the transition', caption: 'Aim for the connection between the two pieces, then release.', alt: 'Timeline during a video drag, with an arrow pointing to the transition between the two source clips.' },
  inserted: { src: insertedImage, title: 'Check the new playback order', caption: 'First piece → new video → second piece. Generate the draft to give it footage.', alt: 'The original two clips connected through a new video, highlighted in the middle of the sequence.' },
  references: { src: referencesImage, title: 'Check Start and End', caption: 'Start uses the first piece. End uses the second piece.', alt: 'Inspector showing checked Start and End references, connected to Before the cut and After the cut respectively.' },
  generate: { src: generateImage, title: 'Describe and generate the scene', caption: 'Follow the arrows: 1. Write a prompt. 2. Set the duration. 3. Click Generate.', alt: 'Inspector screenshot with numbered arrows to the prompt box, Duration field, and Generate button.' },
  save: { src: saveImage, title: 'Save your project', caption: 'Open File and choose Save project to keep your edit.', alt: 'File menu with an arrow pointing to Save project.' },
  templates: { src: templatesImage, title: 'Add a template', caption: 'Drag one of these templates onto the timeline to add its clips.', alt: 'Add clips panel showing Question & response, Loop until ready, and Simple scene, with an arrow pointing to a template card.' },
  workspace: { src: workspaceImage, title: 'Find your panels', caption: 'Use Window to reopen a panel or lock your layout.', alt: 'Window menu with arrows pointing to Add clips and Lock workspace.' },
};
export type HelpPictureId = keyof typeof pictures;
const pictureSizes = { ...dimensions, overview: { width: 560, height: 500 } };

export function HelpPicture({ id, onOpen, caption = true }: { id: HelpPictureId; onOpen: (id: HelpPictureId, trigger: HTMLButtonElement) => void; caption?: boolean }) {
  const picture = pictures[id], size = pictureSizes[id];
  return <figure className="help-picture">
    <button type="button" className="help-picture-button" aria-label={`Enlarge image: ${picture.title}`} aria-haspopup="dialog" onClick={event => onOpen(id, event.currentTarget)}>
      <img src={picture.src} alt={picture.alt} width={size.width} height={size.height} loading="lazy" decoding="async"/>
      <span className="help-picture-action"><ZoomIn size={14} aria-hidden/>Enlarge picture</span>
    </button>
    {caption&&<figcaption>{picture.caption}</figcaption>}
  </figure>;
}

export function HelpPictureViewer({ id, onClose, restoreFocus }: { id: HelpPictureId; onClose: () => void; restoreFocus: () => void }) {
  const [actualSize, setActualSize] = useState(false);
  const picture = pictures[id], size = pictureSizes[id];
  return <ModalBackdrop labelledBy="help-picture-title" onCancel={onClose} restoreFocus={restoreFocus}>
    <section className="help-picture-viewer" onKeyDown={event => event.stopPropagation()}>
      <header><h2 id="help-picture-title">{picture.title}</h2><button autoFocus className="icon-button" aria-label="Close enlarged picture" onClick={onClose}><X size={20}/></button></header>
      <div className="help-picture-tools"><button className="button small" aria-pressed={actualSize} onClick={() => setActualSize(value => !value)}>{actualSize?<Maximize2 size={14} aria-hidden/>:<ZoomIn size={14} aria-hidden/>}{actualSize?'Fit to window':'Actual size'}</button><span>{actualSize?'Scroll to explore the picture.':'Choose Actual size to read the small controls.'}</span></div>
      <div className={`help-picture-stage ${actualSize?'actual-size':''}`} tabIndex={0} role="region" aria-label="Enlarged tutorial picture">
        <img src={picture.src} alt={picture.alt} width={size.width} height={size.height}/>
      </div>
      <footer>{picture.caption}</footer>
    </section>
  </ModalBackdrop>;
}
