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
import mediaImage from './images/media.png';
import imageImage from './images/image.png';
import charactersImage from './images/characters.png';
import previewImage from './images/preview.png';

const pictures = {
  overview: { src: overviewImage, title: 'Where the new scene goes', caption: 'Your video plays, the new scene plays, then your video continues.', alt: 'Diagram with three boxes connected by downward arrows: Your video plays, Your new scene plays, Your video continues. The middle box is labeled New scene.' },
  import: { src: importImage, title: 'Import your video', caption: 'Drop a video on the empty timeline, or click Import videos or images.', alt: 'Empty timeline that says Drop videos or images here, with an arrow pointing to the Import videos or images button.' },
  playhead: { src: playheadImage, title: 'Choose the insertion point', caption: 'The vertical playhead marks where your new scene will begin.', alt: 'Timeline screenshot showing the playhead positioned inside an example video clip.' },
  cut: { src: cutImage, title: 'Cut at the playhead', caption: 'Right-click the clip and choose Cut at playhead.', alt: 'Clip right-click menu with Cut at playhead outlined and indicated by an arrow.' },
  split: { src: splitImage, title: 'One clip becomes two pieces', caption: 'A cut keeps both pieces of your video and connects them in order.', alt: 'Two video clips labeled First piece and Second piece, with the connecting line highlighted between them.' },
  add: { src: addImage, title: 'Find the Video card', caption: 'This is the card to drag from the Add clips panel.', alt: 'Add clips panel with the Video card outlined and an arrow labeled Drag this card.' },
  drop: { src: dropImage, title: 'Drop onto the connecting line', caption: 'Aim for the line between the two pieces, then release.', alt: 'Timeline during a video drag, with an arrow pointing to the connecting line between the two clips.' },
  inserted: { src: insertedImage, title: 'Check the new playback order', caption: 'First piece → new scene → second piece. The new scene is empty until you generate it.', alt: 'The original two clips connected through a new, not yet generated scene highlighted in the middle of the sequence.' },
  references: { src: referencesImage, title: 'Check Start and End', caption: 'Start video uses the end of the first piece. End video uses the beginning of the second piece. Duration is the length of the new scene.', alt: 'Generation timeline with arrows pointing to the checked Start video and End video boxes and to the Duration field.' },
  generate: { src: generateImage, title: 'Describe and generate the scene', caption: 'Follow the arrows: 1. Write a prompt. 2. Open Timeline to check what the scene matches. 3. Click Generate.', alt: 'Inspector screenshot with numbered arrows to the prompt box, the Timeline summary, and the Generate button.' },
  save: { src: saveImage, title: 'Save your project', caption: 'Open File and choose Save project to keep your edit.', alt: 'File menu with an arrow pointing to Save project.' },
  templates: { src: templatesImage, title: 'Add a template', caption: 'Drag one of these templates onto the timeline to add its clips.', alt: 'Add clips panel showing Question & response, Loop until ready, and Simple scene, with an arrow pointing to a template card.' },
  workspace: { src: workspaceImage, title: 'Find your panels', caption: 'Use Window to reopen a panel or lock your layout.', alt: 'Window menu with arrows pointing to Add clips and Lock workspace.' },
  media: { src: mediaImage, title: 'Image and Audio cards', caption: 'Drag Image or Audio onto the timeline the same way as Video.', alt: 'Add clips panel with arrows pointing to the Image card, labeled Make a picture, and the Audio card, labeled Make speech or sound.' },
  image: { src: imageImage, title: 'Describe a picture', caption: 'Pick a model, describe the picture, then click Generate image below.', alt: 'Inspector for an image clip with numbered arrows to the Model menu and the prompt box.' },
  characters: { src: charactersImage, title: 'Add a character', caption: 'Click empty timeline space to see Project settings, then Add character.', alt: 'Project settings in Inspector with an arrow pointing to the Add character button in the Characters section.' },
  preview: { src: previewImage, title: 'Watch in Preview', caption: 'Preview hides the editing tools. Click Edit to come back.', alt: 'Preview mode showing only the video player, with an arrow pointing to the Edit button in the top bar.' },
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
