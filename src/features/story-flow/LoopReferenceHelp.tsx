import { useId } from 'react';
import { CircleHelp, X } from 'lucide-react';

export default function LoopReferenceHelp() {
  const id = useId();
  return <>
    <button type="button" className="icon-button small" aria-label="About loop references" title="About loop references" popoverTarget={id}><CircleHelp size={14} /></button>
    <div id={id} popover="auto" className="inspector-status-popover" role="dialog" aria-label="Loop reference help">
      <div><strong>One reference for both ends</strong><button type="button" className="icon-button small" aria-label="Close loop reference help" popoverTarget={id} popoverTargetAction="hide"><X size={14} /></button></div>
      <p>A seamless loop needs to return to its starting pose. Loop ref guides both the beginning and the end; outgoing clips do not supply a different ending.</p>
      <p><strong>None:</strong> creates a loop from your prompt, with no video or image required. Describe motion that returns to its starting pose. <strong>Video:</strong> uses the incoming clip’s tail, then holds its final frame as the ending reference. <strong>Image:</strong> uses your selected picture to guide both the first and last frames.</p>
      <p>Enable Loop before generating. Turning it on for an existing video only repeats that saved video; regenerate to apply the shared reference. Imported source videos keep their original frames.</p>
      <p>Matching references help close the loop. Motion, lighting and sound must also return smoothly—preview the repeat to check the seam.</p>
    </div>
  </>;
}
