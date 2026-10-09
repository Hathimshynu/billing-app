/** POS keyboard actions and their default keys. Users can remap them in Settings → POS. */
export const POS_ACTIONS = {
  search: { label: 'Focus product search', default: 'F2' },
  customer: { label: 'Select customer', default: 'F4' },
  discount: { label: 'Bill discount', default: 'F6' },
  held: { label: 'Held bills', default: 'F7' },
  pay: { label: 'Payment', default: 'F8' },
  hold: { label: 'Hold bill', default: 'F9' },
  edit_line: { label: 'Edit selected line', default: 'F3' },
  delete_line: { label: 'Remove selected line', default: 'Delete' },
  clear: { label: 'Clear cart', default: 'Ctrl+Delete' },
} as const;

export type PosAction = keyof typeof POS_ACTIONS;

/** combo → action, honouring the user's overrides. */
export function shortcutMap(overrides: Record<string, string>): Record<string, PosAction> {
  const map: Record<string, PosAction> = {};
  for (const [action, def] of Object.entries(POS_ACTIONS) as Array<[PosAction, (typeof POS_ACTIONS)[PosAction]]>) {
    const combo = overrides[action] || def.default;
    if (combo) map[combo] = action;
  }
  return map;
}

export function shortcutFor(overrides: Record<string, string>, action: PosAction): string {
  return overrides[action] || POS_ACTIONS[action].default;
}
