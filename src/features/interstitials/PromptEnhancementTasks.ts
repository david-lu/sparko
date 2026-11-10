export type PromptEditResult = { applied: boolean; error?: string };
type Phase = 'idle' | 'enhancing' | 'analyzing';
type Task = { operation: AbortController; phase: Phase; unsubscribe?: () => void };

/** Clip-owned requests survive Inspector unmounts, but never changes to their inputs. */
export class PromptEnhancementTasks {
  private tasks = new Map<string, Task>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getPhase = (id: string) => this.tasks.get(id)?.phase ?? 'idle';
  private emit() { this.listeners.forEach(listener => listener()); }
  cancel(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    this.tasks.delete(id); task.unsubscribe?.(); task.operation.abort(); this.emit();
  }
  dispose() { for (const id of this.tasks.keys()) this.cancel(id); }

  async run<T>(id: string, options: {
    isCurrent: () => boolean;
    subscribe: (check: () => void) => () => void;
    execute: (signal: AbortSignal, onAnalyzing: (active: boolean) => void) => Promise<T>;
    apply: (result: T) => void;
    onError: (message: string) => void;
  }): Promise<PromptEditResult> {
    if (this.tasks.has(id) || !options.isCurrent()) return { applied: false };
    const task: Task = { operation: new AbortController(), phase: 'enhancing' };
    this.tasks.set(id, task);
    task.unsubscribe = options.subscribe(() => { if (!options.isCurrent()) this.cancel(id); });
    this.emit();
    const current = () => this.tasks.get(id) === task && !task.operation.signal.aborted && options.isCurrent();
    try {
      const result = await options.execute(task.operation.signal, active => {
        if (current()) { task.phase = active ? 'analyzing' : 'enhancing'; this.emit(); }
      });
      if (current()) {
        // Applying the result changes the inputs itself; stop watching first.
        task.unsubscribe?.(); task.unsubscribe = undefined;
        options.apply(result);
        return { applied: true };
      }
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : 'Try again.';
        options.onError(message);
        return { applied: false, error: message };
      }
    } finally {
      task.unsubscribe?.();
      if (this.tasks.get(id) === task) { this.tasks.delete(id); this.emit(); }
    }
    return { applied: false, error: 'The prompt or settings changed, or the request was cancelled. Try again.' };
  }
}
