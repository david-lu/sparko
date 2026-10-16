import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { HttpError } from './http';

export async function videoDuration(blob: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!await input.getPrimaryVideoTrack()) throw new HttpError(400, 'The file must contain a video track.');
    return await input.computeDuration();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'This video could not be read. Use a valid MP4, MOV, or WebM file.');
  } finally { input.dispose(); }
}
