import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.route('**/__resampling-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio resampling</title>' }));
  await page.goto('/__resampling-test');
}

for (const [inputRate, outputRate, channels] of [[32000, 48000, 2], [44100, 48000, 1], [96000, 48000, 2], [48000, 44100, 2]]) {
  test(`chunked ${inputRate} Hz audio matches continuous ${outputRate} Hz resampling`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async ({ inputRate, outputRate, channels }) => {
      const { resampledAudio } = await import('/src/media/ResampledAudio.ts' as string);
      const length = Math.round(inputRate * 1.137), origin = 1.234567;
      const input = new AudioBuffer({ numberOfChannels: channels, length, sampleRate: inputRate });
      for (let channel = 0; channel < channels; channel++) {
        const data = input.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = .3 * Math.sin(i / inputRate * 2 * Math.PI * (731 + 123 * channel))
          + .1 * Math.sin(i / inputRate * 2 * Math.PI * Math.min(inputRate * .4, 27000));
      }
      async function* chunks() {
        for (let from = 0; from < length; from += 1024) {
          const buffer = new AudioBuffer({ numberOfChannels: channels, length: Math.min(1024, length - from), sampleRate: inputRate });
          for (let channel = 0; channel < channels; channel++) buffer.copyToChannel(input.getChannelData(channel).subarray(from, from + buffer.length), channel);
          yield { buffer, timestamp: Math.round((origin + from / inputRate) * 1e6) / 1e6, duration: buffer.duration };
        }
      }
      const outputLength = Math.round(length * outputRate / inputRate);
      const referenceContext = new OfflineAudioContext(channels, outputLength, outputRate);
      const original = referenceContext.createBufferSource(); original.buffer = input; original.connect(referenceContext.destination); original.start();
      const reference = await referenceContext.startRendering();
      const scheduledContext = new OfflineAudioContext(channels, outputLength, outputRate);
      let end = origin, maxGap = 0, count = 0, maxBlockDuration = 0, outputFrames = 0;
      for await (const sample of resampledAudio(chunks(), outputRate)) {
        maxGap = Math.max(maxGap, Math.abs(sample.timestamp - end)); end = sample.timestamp + sample.duration;
        maxBlockDuration = Math.max(maxBlockDuration, sample.duration); outputFrames += sample.buffer.length; count++;
        if (sample.buffer.sampleRate !== outputRate || sample.buffer.numberOfChannels !== channels) throw new Error('Unexpected audio format');
        const source = scheduledContext.createBufferSource(); source.buffer = sample.buffer; source.connect(scheduledContext.destination);
        source.start(sample.timestamp - origin);
      }
      const actual = await scheduledContext.startRendering();
      let maxError = 0;
      for (let channel = 0; channel < channels; channel++) {
        const expected = reference.getChannelData(channel), data = actual.getChannelData(channel);
        for (let i = 0; i < data.length; i++) maxError = Math.max(maxError, Math.abs(data[i] - expected[i]));
      }
      return { maxGap, maxError, count, outputFrames, outputLength, maxBlockDuration };
    }, { inputRate, outputRate, channels });
    expect(result.maxGap).toBeLessThan(1e-9);
    expect(result.maxError).toBeLessThan(.00001);
    expect(result.outputFrames).toBe(result.outputLength);
    expect(result.count).toBeGreaterThan(4);
    expect(result.maxBlockDuration).toBeLessThan(.26);
  });
}

test('resampling preserves gaps and format changes, and passes matching audio through', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { resampledAudio } = await import('/src/media/ResampledAudio.ts' as string);
    const inputs = [[32000, 2, 0], [32000, 2, 1], [44100, 1, 2], [48000, 2, 3]].map(([sampleRate, numberOfChannels, timestamp]) => {
      const buffer = new AudioBuffer({ sampleRate, numberOfChannels, length: Math.round(sampleRate * .1) });
      return { buffer, timestamp, duration: buffer.duration };
    });
    async function* chunks() { yield* inputs; }
    const outputs = [];
    for await (const sample of resampledAudio(chunks(), 48000)) outputs.push(sample);
    return { outputs: outputs.map(sample => ({ time: sample.timestamp, duration: sample.duration, rate: sample.buffer.sampleRate, channels: sample.buffer.numberOfChannels })),
      passthrough: outputs.at(-1)!.buffer === inputs.at(-1)!.buffer };
  });
  expect(result.outputs).toEqual([
    { time: 0, duration: .1, rate: 48000, channels: 2 }, { time: 1, duration: .1, rate: 48000, channels: 2 },
    { time: 2, duration: .1, rate: 48000, channels: 1 }, { time: 3, duration: .1, rate: 48000, channels: 2 },
  ]);
  expect(result.passthrough).toBe(true);
});

test('resampling yields with bounded lookahead and closes its decoder iterator on cancellation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { resampledAudio } = await import('/src/media/ResampledAudio.ts' as string);
    let read = 0, closed = false, duration = 0;
    async function* chunks() {
      try {
        for (let i = 0; i < 10000; i++) {
          const buffer = new AudioBuffer({ sampleRate: 32000, numberOfChannels: 2, length: 1024 }); read++;
          yield { buffer, timestamp: i * 1024 / 32000, duration: buffer.duration };
        }
      } finally { closed = true; }
    }
    for await (const sample of resampledAudio(chunks(), 48000)) { duration = sample.duration; break; }
    return { read, closed, duration };
  });
  expect(result.read).toBeLessThan(12);
  expect(result.closed).toBe(true);
  expect(result.duration).toBe(.25);
});
