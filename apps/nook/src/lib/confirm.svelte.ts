// Styled stand-in for window.confirm(): `await ask({...})` resolves to the chosen
// button's value, or null when dismissed. ConfirmDialog (mounted once in App) draws it.

export type Choice<T> = { label: string; value: T; danger?: boolean };
type Request = { title: string; message?: string; choices: Choice<unknown>[]; resolve: (v: unknown) => void };

export const dialog = $state<{ current: Request | null }>({ current: null });

export function ask<T>(o: { title: string; message?: string; choices: Choice<T>[] }): Promise<T | null> {
  dialog.current?.resolve(null);
  return new Promise(resolve => { dialog.current = { ...o, resolve: resolve as (v: unknown) => void }; });
}

/** The common case: one action plus Cancel. */
export const confirmAction = (title: string, message: string, label: string, danger = false) =>
  ask({ title, message, choices: [{ label, value: true, danger }] }).then(v => v === true);

export function answer(v: unknown): void {
  const r = dialog.current;
  dialog.current = null;
  r?.resolve(v);
}
