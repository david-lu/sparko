/** Model authors' guidance, reviewed 2026-11-03. Keep the source next to each rule set. */
const google = {
  title: 'Google · Nano Banana prompting', url: 'https://ai.google.dev/gemini-api/docs/image-generation#prompt-guide',
  rules: 'Write a concrete scene description in natural sentences. Clarify subject, setting, lighting, framing and the requested medium. For photographic work, use camera or lens details only when they serve the brief. For illustrations, specify relevant line, color and texture choices. Quote exact visible lettering and describe its placement. Break a complex composition into clear spatial instructions. For editing, identify the requested change and preserve unrelated identity, composition, lighting and perspective. Assign each reference image its requested role; do not assume every reference is a base image. Express exclusions as the intended visual result where possible.',
};
const flux = {
  title: 'BFL · FLUX.2 Pro & Max prompting', url: 'https://docs.bfl.ai/guides/prompting_guide_flux2',
  rules: 'Lead with the main subject, then its action or pose, the requested style and the setting. Put essential details ahead of secondary ones. Usually use 30–80 words; keep extra detail only for a complex brief. FLUX.2 has no negative-prompt input: translate exclusions into affirmative descriptions. Keep requested color hex values attached to specific objects. Quote exact lettering and describe typography and placement. For multi-reference edits, name images by their one-based number and explain what each contributes, keeping identity and unrelated features consistent. Use clear prose unless the draft deliberately uses structured JSON; preserve that structure when present.',
};
const seedream = {
  title: 'ByteDance · Seedream 4.0–4.5 prompt guide', url: 'https://console.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0-prompt-guide',
  rules: 'Use compact, unambiguous sentences describing the subject, its action and the environment. State the intended application, such as a poster or product photograph, when supplied. Add specific style and composition details without stacking decorative quality words. Put exact visible text in double quotation marks. For edits, identify the target object and change precisely, and explicitly retain unaffected features. For several input images, state which numbered image supplies each subject, material or style. Only request a series or sequence when the user asks for one; otherwise describe one composition.',
};
const ideogram = {
  title: 'Ideogram · Prompt structure', url: 'https://docs.ideogram.ai/prompting/prompt-structure',
  rules: 'Begin with the image type, main subject and overall intent. Follow with defining subject details, placement or pose, needed secondary elements, setting, lighting, composition and finish. Prioritize clear relationships over a keyword pile. For lettering, preserve exact words in quotation marks and specify location, hierarchy and relevant font characteristics. Describe visible content, not commands to change generation settings. Keep the prompt focused on the requested design; do not invent slogans, logos or decorative text. This integration uses text-to-image with Magic Prompt disabled, so return the final usable description directly.',
};
export const IMAGE_PROMPT_GUIDES: Record<string, { title: string; url: string; rules: string }> = {
  'nano-banana-2': google, 'nano-banana-pro': google,
  'flux-2-pro': flux, 'flux-2-max': flux,
  'seedream-4.5': seedream, 'ideogram-v3': ideogram,
};
