import { GitBranch, Image, Music, Repeat2, Sparkles, Video } from 'lucide-react';
import { behaviors } from './behaviors';
import type { StoryNode } from './model';

export default function ClipTypeIcon({ node }: { node: StoryNode }) {
  const { loop, conditional } = behaviors(node);
  const kind=node.source?.kind??node.mediaKind;
  const media = kind==='audio'?'Audio': kind === 'image' ? 'Still image' : node.kind === 'source' ? 'Source video' : 'Generated video';
  const label = [media, loop && 'Loop', conditional && 'Conditional'].filter(Boolean).join(' · ');
  const Icon = conditional ? GitBranch : loop ? Repeat2 : kind==='audio'?Music : kind === 'image' ? Image : node.kind === 'source' ? Video : Sparkles;
  return <span className="story-clip-type" role="img" aria-label={label} title={label}>
    <Icon size={12} aria-hidden />
    {conditional && loop && <Repeat2 className="story-clip-secondary-type" size={12} aria-hidden />}
  </span>;
}
