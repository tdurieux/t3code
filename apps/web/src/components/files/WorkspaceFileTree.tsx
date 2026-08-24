import type { FileTreeProps } from "@pierre/trees/react";
import { FileTree } from "@pierre/trees/react";

import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { useTheme } from "~/hooks/useTheme";

export const WORKSPACE_FILE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

export function WorkspaceFileTree({ style, ...props }: FileTreeProps) {
  const { resolvedTheme } = useTheme();

  return (
    <FileTree
      {...props}
      style={{
        colorScheme: resolvedTheme,
        ["--trees-fg-override" as string]: "var(--contrast-foreground)",
        ...style,
      }}
    />
  );
}

export function WorkspaceFileTreeSearchField(props: {
  ariaLabel: string;
  name: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder ?? "Search files"}
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}
