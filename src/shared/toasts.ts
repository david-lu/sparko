export type ErrorToast = { id: string; title: string; message: string; source?: string };
let notifications: ErrorToast[] = [];
const listeners = new Set<() => void>();
const publish = (next: ErrorToast[]) => { notifications = next; listeners.forEach(listener => listener()); };

export const subscribeToasts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getToasts = () => notifications;
export const dismissToast = (id: string) => publish(notifications.filter(toast => toast.id !== id));

/** Keep errors readable until dismissed, and replace repeat failures from the same action. */
export function showErrorToast(title: string, message: string, source?: string) {
  publish([...notifications.filter(toast => toast.title !== title || toast.source !== source), { id: crypto.randomUUID(), title, message, source }].slice(-3));
}
