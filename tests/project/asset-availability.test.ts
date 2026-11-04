import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/features/project/assets';
import { readAsset } from '../../src/features/project/database';
import type { Asset } from '../../src/features/project/types';

vi.mock('../../src/features/project/database', () => ({ readAsset: vi.fn(), writeAsset: vi.fn() }));
afterEach(() => { assets.releaseExcept(new Set()); vi.resetAllMocks(); });

describe('local media availability', () => {
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
});
