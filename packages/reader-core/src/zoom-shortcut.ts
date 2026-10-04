export function zoomCommand(input: {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): "in" | "out" | "width" | null {
  if (!(input.metaKey || input.ctrlKey) || input.altKey || input.isComposing)
    return null;
  if (input.key === "+" || input.key === "=" || input.code === "NumpadAdd")
    return "in";
  if (input.key === "-" || input.code === "NumpadSubtract") return "out";
  if (input.key === "0" || input.code === "Numpad0") return "width";
  return null;
}
