export interface CodeNavigationModifierState {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

const CODE_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;

export function isCodeNavigationGesture(event: CodeNavigationModifierState): boolean {
  return event.metaKey || event.ctrlKey;
}

export function isCodeNavigationIdentifier(value: string): boolean {
  return CODE_IDENTIFIER_PATTERN.test(value.trim());
}
