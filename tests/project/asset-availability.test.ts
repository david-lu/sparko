import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/features/project/assets';
import { readAsset } from '../../src/features/project/database';
import type { Asset } from '../../src/features/project/types';

vi.mock('../../src/features/project/database', () => ({ readAsset: vi.fn(), writeAsset: vi.fn() }));
afterEach(() => { assets.setDeleted([]); assets.releaseExcept(new Set()); vi.resetAllMocks(); });

describe('local media availability', () => {
  it('marks deletion as unavailable even when the stored blob is retained for undo', async () => {
    const id = crypto.randomUUID();
    vi.mocked(readAsset).mockResolvedValue({ id, name: 'Reference.png', blob: new Blob(['image']) });
    const { url } = await assets.open(id);
    expect(url).toBeTruthy();
    assets.setDeleted([id]);
    expect(assets.url(id)).toBeUndefined();
    expect(assets.error(id)).toContain('deleted');
    await expect(assets.open(id)).rejects.toThrow('deleted');
    expect(readAsset).toHaveBeenCalledTimes(1);
    assets.setDeleted([]);
    await assets.open(id);
    expect(assets.error(id)).toBeUndefined();
    expect(assets.url(id)).toBeTruthy();
  });
  it('cannot resurrect a deleted asset when an older read finishes', async () => {
    const id = crypto.randomUUID(); let finish!: (asset: Asset) => void;
    vi.mocked(readAsset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = assets.open(id);
    assets.setDeleted([id]);
    finish({ id, name: 'Reference.png', blob: new Blob(['image']) });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(assets.url(id)).toBeUndefined(); expect(assets.error(id)).toContain('deleted');
  });
  it('does not flag pending reads and shares one read between consumers', async () => {
    const id = crypto.randomUUID(); let finish!: (asset: Asset) => void;
    vi.mocked(readAsset).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const changed = vi.fn(), unsubscribe = assets.subscribe(changed);
    assets.check(id); assets.check(id); const opened = assets.open(id);
    expect(readAsset).toHaveBeenCalledTimes(1); expect(assets.error(id)).toBeUndefined(); expect(changed).not.toHaveBeenCalled();
    finish({ id, name: 'image.png', blob: new Blob(['image'], { type: 'image/png' }) });
    await opened; expect(assets.url(id)).toBeTruthy(); expect(changed).toHaveBeenCalledOnce();
    assets.check(id); expect(readAsset).toHaveBeenCalledTimes(1); unsubscribe();
  });
  it('surfaces missing files, avoids retry loops, and clears errors after a successful reopen', async () => {
    const id = crypto.randomUUID(); vi.mocked(readAsset).mockResolvedValue(undefined);
    await expect(assets.open(id)).rejects.toThrow('missing'); expect(assets.error(id)).toContain('project backup');
    assets.check(id); assets.check(id); expect(readAsset).toHaveBeenCalledTimes(1);
    vi.mocked(readAsset).mockResolvedValue({ id, name: 'restored.mp4', blob: new Blob(['video']) });
    await assets.open(id); expect(assets.error(id)).toBeUndefined();
  });
  it('rejects empty files instead of leaving a loading preview forever', async () => {
    const id = crypto.randomUUID(); vi.mocked(readAsset).mockResolvedValue({ id, name: 'empty.mp4', blob: new Blob() });
    await expect(assets.open(id)).rejects.toThrow('empty'); expect(assets.error(id)).toContain('working file'); expect(assets.url(id)).toBeUndefined();
  });
  it('does not recreate an object URL when a released read finishes late', async () => {
    const id = crypto.randomUUID(); let finish!: (asset: Asset) => void;
    vi.mocked(readAsset).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const opened = assets.open(id), assertion = expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    assets.releaseExcept(new Set());
    finish({ id, name: 'old.png', blob: new Blob(['old']) }); await assertion;
    expect(assets.url(id)).toBeUndefined(); expect(assets.error(id)).toBeUndefined();
  });
  it('does not remove a newer pending read when a released read finishes', async () => {
    const id = crypto.randomUUID(); let first!: (asset: Asset) => void, second!: (asset: Asset) => void;
    vi.mocked(readAsset).mockReturnValueOnce(new Promise(resolve => { first = resolve; })).mockReturnValueOnce(new Promise(resolve => { second = resolve; }));
    const stale = assets.open(id), assertion = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    assets.releaseExcept(new Set()); const current = assets.open(id);
    first({ id, name: 'old.png', blob: new Blob(['old']) }); await assertion;
    const shared = assets.open(id); expect(readAsset).toHaveBeenCalledTimes(2);
    second({ id, name: 'new.png', blob: new Blob(['new']) });
    expect((await current).asset.name).toBe('new.png'); expect((await shared).url).toBe(assets.url(id));
  });
});
