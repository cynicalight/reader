/** Leave Shift+Z (redo), Alt combinations and IME input to their native owners. */
export function annotationUndoShortcut(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    event.key.toLowerCase() === "z"
  );
}
