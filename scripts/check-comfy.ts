import dotenv from 'dotenv';
import { createComfyProvider } from '../server/features/comfy/provider';
dotenv.config({ quiet: true });
const upscale = process.argv.includes('--2k');
const provider = createComfyProvider(process.env);
// Upscale to 2K is its own job; check it with the exact-frame nodes it may use.
const status = await provider.check('standard'), upscaleStatus = upscale && status.ready ? await provider.checkUpscale(true) : status;
const ready = status.ready && upscaleStatus.ready;
console.log(ready ? `Comfy Cloud is ready: required H3 models${upscale ? ', official H3-Regenerate-2K partner node for Upscale to 2K,' : ''} and masking nodes are available. No generation was submitted.` : upscaleStatus.message ?? status.message);
if (!ready) process.exitCode = 1;
