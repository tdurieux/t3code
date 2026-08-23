import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

export function ReviewColumnResizeHandle({
  edge,
  handlers,
}: {
  readonly edge: "left" | "right";
  readonly handlers: ResizableWidthHandlers;
}) {
  return (
    <div
      role="separator"
      aria-label={`Resize ${edge === "left" ? "inspector" : "files"} column`}
      aria-orientation="vertical"
      className={cn(
        "group absolute inset-y-0 z-30 w-2 cursor-col-resize touch-none select-none",
        edge === "left" ? "-left-1" : "-right-1",
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/55 group-active:bg-primary"
      />
    </div>
  );
}
