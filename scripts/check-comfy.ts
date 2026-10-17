import dotenv from 'dotenv';
import { createComfyProvider } from '../server/features/comfy/provider';
dotenv.config({ quiet: true });
const status = await createComfyProvider(process.env).check();
console.log(status.ready ? 'Comfy Cloud is ready: required H3 models and masking nodes are available. No generation was submitted.' : status.message);
if (!status.ready) process.exitCode = 1;
