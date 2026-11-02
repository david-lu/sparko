import dotenv from 'dotenv';
import { createComfyProvider } from '../server/features/comfy/provider';
dotenv.config({ quiet: true });
const resolution = process.argv.includes('--2k') ? '2k' : 'native';
const status = await createComfyProvider(process.env).check('standard',resolution);
console.log(status.ready ? `Comfy Cloud is ready: required H3 models${resolution === '2k' ? ', official H3-Regenerate-2K partner node,' : ''} and masking nodes are available. No generation was submitted.` : status.message);
if (!status.ready) process.exitCode = 1;
