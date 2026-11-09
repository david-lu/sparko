import { expect, it, vi } from 'vitest';
import { PromptEnhancementTasks } from '../../src/features/interstitials/PromptEnhancementTasks';

function pending() {
  let resolve!: (value: string) => void, reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  let current = true, check = () => {}, signal!: AbortSignal, analyzing!: (value: boolean) => void;
  const apply = vi.fn(), onError = vi.fn(), unsubscribe = vi.fn();
  return { resolve, reject, apply, onError, unsubscribe, signal: () => signal, analyze: () => analyzing(true),
    invalidate: () => { current = false; check(); },
    options: {
      isCurrent: () => current,
      subscribe: (listener: () => void) => { check = listener; return unsubscribe; },
      execute: (value: AbortSignal, onAnalyzing: (value: boolean) => void) => { signal = value; analyzing = onAnalyzing; return promise; },
      apply, onError,
    },
  };
}

it('retains independent clip progress after all inspectors unsubscribe and applies to the original clip', async () => {
  const tasks = new PromptEnhancementTasks(), first = pending(), second = pending(), render = vi.fn();
  const unmount = tasks.subscribe(render), a = tasks.run('a', first.options), b = tasks.run('b', second.options);
  unmount(); first.analyze();
  expect(tasks.getPhase('a')).toBe('analyzing'); expect(tasks.getPhase('b')).toBe('enhancing');
  const calls = render.mock.calls.length;
  second.resolve('second'); expect(await b).toEqual({ applied: true });
  expect(second.apply).toHaveBeenCalledWith('second'); expect(first.apply).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(calls); expect(tasks.getPhase('a')).toBe('analyzing');
  first.resolve('first'); expect(await a).toEqual({ applied: true });
  expect(first.apply).toHaveBeenCalledWith('first'); expect(tasks.getPhase('a')).toBe('idle');
});

it('aborts invalidated inputs without a mounted inspector and ignores late responses', async () => {
  const tasks = new PromptEnhancementTasks(), request = pending(), result = tasks.run('a', request.options);
  request.invalidate();
  expect(request.signal().aborted).toBe(true); expect(tasks.getPhase('a')).toBe('idle');
  request.resolve('obsolete'); expect(await result).toMatchObject({ applied: false });
  expect(request.apply).not.toHaveBeenCalled(); expect(request.onError).not.toHaveBeenCalled();
});

it('prevents duplicate submissions and keeps a replacement request active after cancellation', async () => {
  const tasks = new PromptEnhancementTasks(), first = pending(), second = pending();
  const a = tasks.run('a', first.options);
  expect(await tasks.run('a', second.options)).toEqual({ applied: false });
  tasks.cancel('a'); const b = tasks.run('a', second.options);
  first.resolve('cancelled'); await a;
  expect(tasks.getPhase('a')).toBe('enhancing'); expect(first.apply).not.toHaveBeenCalled();
  second.resolve('current'); expect(await b).toEqual({ applied: true });
});

it('reports failures without erasing the draft and allows retry', async () => {
  const tasks = new PromptEnhancementTasks(), first = pending(), result = tasks.run('a', first.options);
  first.reject(new Error('Provider unavailable'));
  expect(await result).toEqual({ applied: false, error: 'Provider unavailable' });
  expect(first.onError).toHaveBeenCalledWith('Provider unavailable'); expect(first.apply).not.toHaveBeenCalled();
  expect(tasks.getPhase('a')).toBe('idle'); expect(first.unsubscribe).toHaveBeenCalled();
  const retry = pending(), next = tasks.run('a', retry.options); retry.resolve('updated');
  expect(await next).toEqual({ applied: true });
});

it('cancels every pending clip when its owner is disposed', async () => {
  const tasks = new PromptEnhancementTasks(), first = pending(), second = pending();
  const a = tasks.run('a', first.options), b = tasks.run('b', second.options);
  tasks.dispose();
  for (const request of [first, second]) { expect(request.signal().aborted).toBe(true); request.resolve('old project'); }
  await Promise.all([a, b]);
  expect(first.apply).not.toHaveBeenCalled(); expect(second.apply).not.toHaveBeenCalled();
});
