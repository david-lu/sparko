import { HttpError } from '../../shared/http.js';
import { cleanH3PromptDraft } from '../../shared/prompt-editing.js';

/** A completed rewrite that the enhancer can correct without retrying a network failure. */
export class PromptRewriteError extends HttpError {
  constructor(message: string) { super(502, message); }
}

const fields = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'] as const;

/** Canonicalize presentation, preserving the actual descriptions and exact dialogue. */
export function formatH3Prompt(value: string) {
  const text = cleanH3PromptDraft(value);
  // A field name spoken inside a dialogue tag is content, never a section boundary.
  const outsideDialogue = text.replace(/<d>[\s\S]*?<\/d>/gi, tag => tag.replace(/[^\n]/g, 'x'));
  const headers = [...outsideDialogue.matchAll(/^[\t ]*(?:\*\*|__)?(integrated_multimodal_description|overall_soundscape|non_diegetic_music)(?:\*\*|__)?[\t ]*:[\t ]*(?:\*\*|__)?/gim)];
  const sections = new Map<string, string>();
  for (const [index, header] of headers.entries()) {
    const field = header[1].toLowerCase();
    if (sections.has(field)) throw new PromptRewriteError(`The rewrite repeated the ${field} section. Return each section exactly once.`);
    sections.set(field, text.slice(header.index! + header[0].length, headers[index + 1]?.index ?? text.length).trim());
  }
  const missing = fields.filter(field => !sections.get(field));
  if (missing.length) throw new PromptRewriteError(`The rewrite omitted or left empty: ${missing.join(', ')}. Complete these sections using the requested scene and sound.`);
  if (text.slice(0, headers[0].index).trim()) throw new PromptRewriteError('The rewrite included text outside its three prompt sections. Put all scene directions in the visual description.');
  let action = sections.get(fields[0])!;
  // The opening marker is formatting, so an otherwise complete single-shot description
  // does not need another model call merely to add it or join it to its field label.
  if (!/\[Shot\s+\d+\]/i.test(action.replace(/<d>[\s\S]*?<\/d>/gi, ''))) action = `[Shot 1] ${action}`;
  action = action.replace(/^\[Shot\s+1\]\s*/i, '[Shot 1] ');
  if (!action.startsWith('[Shot 1] ') || !action.slice('[Shot 1] '.length).trim()) {
    throw new PromptRewriteError('The visual description must begin with the opening shot and its scene description. Preserve any explicitly requested later shots.');
  }
  const prefix = `${fields[0]}: ${action}`;
  const soundscape = sections.get(fields[1])!, music = sections.get(fields[2])!;
  return { prompt: `${prefix}\n${fields[1]}: ${soundscape}\n${fields[2]}: ${music}`, soundscapeStart: prefix.length };
}
