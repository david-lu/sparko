export const dialogueTags = (prompt: string) => [...prompt.matchAll(/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi)].map(match => match[0]);
export const dialogueKey = (tag: string) => tag.replace(/^<d>\s*\[([^\]]+)\]\s*/i, (_, language: string) => `[${language.trim().toLowerCase()}]`).replace(/\s*<\/d>$/i, '');

/** Recognize explicit quoted speech without treating every quoted object or label as dialogue. */
function quotedDialogue(prompt: string): { index: number; tag: string }[] {
  const result: { index: number; tag: string }[] = [];
  for (const match of prompt.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)) {
    const before = prompt.slice(0, match.index);
    const cue = /\b(?:say(?:s|ing)?|said|ask(?:s|ing)?|asked|repl(?:y|ies|ied)|answer(?:s|ed)?|exclaim(?:s|ed)?|whisper(?:s|ed)?|shout(?:s|ed)?|speak(?:s)?)\s*(?:(?:once|aloud|[a-z]+ly)\s*)*[:,]?\s*$/i.exec(before)
      ?? /\b(?:add|restore|include|insert)\s+(?:the\s+)?(?:missing\s+)?(?:spoken\s+)?(?:line|dialogue)\s*[:,]?\s*$/i.exec(before);
    if (!cue) continue;
    const subject = before.slice(Math.max(0, cue.index - 100), cue.index);
    if (/\b(?:sign|screen|poster|label|caption|title|text|shirt)(?:\s+(?:that|which))?\s*$/i.test(subject)
      || /\b(?:not|never|don't|doesn't|without|stop)\s*$/i.test(subject)) continue;
    result.push({ index: match.index, tag: `<d>[English] ${match[1] ?? match[2]}</d>` });
  }
  return result;
}

/** Capture requested words before rewriting, including a quoted correction to an old H3 prompt. */
export function scriptedDialogue(prompt: string, repair = false): string[] {
  const tagged = [...prompt.matchAll(/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi)].map(match => ({ index: match.index, tag: match[0] }));
  const masked = prompt.replace(/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi, tag => ' '.repeat(tag.length));
  const boundary = masked.search(/\boverall_soundscape\s*:/i);
  const actionKeys = new Set(tagged.filter(line => boundary < 0 || line.index < boundary).map(line => dialogueKey(line.tag)));
  // A correction may quote an already tagged line to describe its staging, rather than ask for a second utterance.
  const taggedKeys = new Set(tagged.map(line => dialogueKey(line.tag)));
  const correction = masked.search(/\b(?:correction|fix|update)\s*:/i);
  return [...tagged.filter(line => !repair || boundary < 0 || line.index < boundary || !actionKeys.has(dialogueKey(line.tag))),
    ...quotedDialogue(masked).filter(line => !repair || correction < 0 || line.index < correction || !taggedKeys.has(dialogueKey(line.tag)))]
    .sort((a, b) => a.index - b.index).map(line => line.tag);
}
