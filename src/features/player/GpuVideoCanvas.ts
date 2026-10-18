import type { VideoSample } from 'mediabunny';
import { generatedClipFit } from '../../media/videoFraming';

export type CanvasLayer = { sample: VideoSample; opacity: number; sourceFootage: boolean };
const shader = `
struct Params { scale: vec2f, opacity: f32, rotation: f32, flip: f32, pad: vec3f }
@group(0) @binding(0) var image: texture_external;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let positions = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  let p = positions[index];
  return Vertex(vec4f(p,0,1), vec2f((p.x+1)*0.5, (1-p.y)*0.5));
}
@fragment fn fragment(in: Vertex) -> @location(0) vec4f {
  var uv = (in.uv - vec2f(0.5)) * params.scale + vec2f(0.5);
  if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(0,0,0,params.opacity); }
  if (params.flip > 0.5) { uv.x = 1-uv.x; }
  if (params.rotation == 1) { uv = vec2f(uv.y,1-uv.x); }
  if (params.rotation == 2) { uv = vec2f(1-uv.x,1-uv.y); }
  if (params.rotation == 3) { uv = vec2f(1-uv.y,uv.x); }
  let color = textureSampleBaseClampToEdge(image, linearSampler, uv);
  return vec4f(color.rgb, color.a * params.opacity);
}`;

/** One opaque sRGB output surface for playback, paused frames and dissolves. */
export class GpuVideoCanvas {
  private device?: GPUDevice;
  private context?: GPUCanvasContext;
  private fallback?: CanvasRenderingContext2D;
  private pipeline?: GPURenderPipeline;
  private sampler?: GPUSampler;
  private uniforms: GPUBuffer[] = [];
  private disposed = false;
  ready = false;
  error?: Error;
  constructor(readonly canvas: HTMLCanvasElement) { void this.initialize().catch(error => { this.error = error; }); }
  private async initialize() {
    const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
    if (this.disposed) return;
    if (!adapter) {
      this.fallback = this.canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }) ?? undefined;
      if (!this.fallback) throw new Error('Unable to create the video canvas.');
      this.canvas.dataset.renderer = 'canvas2d'; this.ready = true; return;
    }
    const device = await adapter.requestDevice();
    if (this.disposed) { device.destroy(); return; }
    this.device = device;
    void device.lost.then(info => { if (!this.disposed) this.error = new Error(`The video GPU was disconnected. Reload to resume playback. ${info.message}`); });
    device.addEventListener('uncapturederror', event => { this.error = new Error(event.error.message); });
    this.context = this.canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
    const module = device.createShaderModule({ code: shader });
    this.pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      } }] }, primitive: { topology: 'triangle-list' } });
    if (this.disposed) return;
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.uniforms = [0, 1].map(() => device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.canvas.dataset.renderer = 'webgpu'; this.ready = true;
  }
  draw(layers: CanvasLayer[], matchFraming: boolean) {
    if (this.error) throw this.error;
    if (!this.ready) return false;
    const { width, height } = this.canvas;
    if (this.fallback) {
      this.fallback.globalAlpha = 1; this.fallback.fillStyle = '#000'; this.fallback.fillRect(0, 0, width, height);
      for (const { sample, opacity, sourceFootage } of layers) {
        this.fallback.globalAlpha = opacity;
        const fit = matchFraming && !sourceFootage ? generatedClipFit(sample.displayWidth, sample.displayHeight, width, height) : 'contain';
        if (fit === 'contain') {
          const scale = Math.min(width / sample.displayWidth, height / sample.displayHeight);
          const x = (width - sample.displayWidth * scale) / 2, y = (height - sample.displayHeight * scale) / 2;
          this.fallback.fillRect(0, 0, x, height); this.fallback.fillRect(width - x, 0, x, height);
          this.fallback.fillRect(x, 0, width - 2 * x, y); this.fallback.fillRect(x, height - y, width - 2 * x, y);
        }
        sample.drawWithFit(this.fallback, { fit });
      }
      this.fallback.globalAlpha = 1; return true;
    }
    const device = this.device!, encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pipeline!);
    const frames: VideoFrame[] = [];
    try {
      layers.forEach(({ sample, opacity, sourceFootage }, index) => {
        const ratio = (width / height) / (sample.displayWidth / sample.displayHeight);
        const cover = matchFraming && !sourceFootage && generatedClipFit(sample.displayWidth, sample.displayHeight, width, height) === 'cover';
        const scale = cover ? [Math.min(1, ratio), Math.min(1, 1 / ratio)] : [Math.max(1, ratio), Math.max(1, 1 / ratio)];
        device.queue.writeBuffer(this.uniforms[index], 0, new Float32Array([...scale, opacity, sample.rotation / 90, Number(sample.flip), 0, 0, 0, 0, 0, 0, 0]));
        const frame = sample.toVideoFrame(); frames.push(frame);
        const group = device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [
          { binding: 0, resource: device.importExternalTexture({ source: frame, colorSpace: 'srgb' }) },
          { binding: 1, resource: this.sampler! }, { binding: 2, resource: { buffer: this.uniforms[index] } },
        ] });
        pass.setBindGroup(0, group); pass.draw(3);
      });
      pass.end(); device.queue.submit([encoder.finish()]);
    } finally { frames.forEach(frame => frame.close()); }
    return true;
  }
  dispose() { this.disposed = true; this.uniforms.forEach(buffer => buffer.destroy()); this.context?.unconfigure(); this.device?.destroy(); }
}
