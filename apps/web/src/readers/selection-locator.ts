import { Locator } from "@readium/shared";
function selector(element: Element): string {
  const parts: string[] = [];
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const tag = current.localName;
    const peers = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (s) => s.localName === tag,
        )
      : [current];
    parts.unshift(`${tag}:nth-of-type(${peers.indexOf(current) + 1})`);
  }
  return parts.join(" > ");
}
function point(node: Node, offset: number) {
  if (node.nodeType !== 3 || !node.parentElement) return undefined;
  const siblings = Array.from(node.parentElement.childNodes).filter(
    (child) => child.nodeType === 3,
  );
  return {
    cssSelector: selector(node.parentElement),
    textNodeIndex: siblings.indexOf(node as ChildNode),
    charOffset: offset,
  };
}
export function selectionLocator(
  base: Locator,
  range: Range,
): Locator | undefined {
  const start = point(range.startContainer, range.startOffset);
  const end = point(range.endContainer, range.endOffset);
  if (!start || !end) return undefined;
  const root = range.startContainer.ownerDocument!.body;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return Locator.deserialize({
    ...base.serialize(),
    locations: { ...base.locations.serialize(), domRange: { start, end } },
    text: {
      highlight: range.toString(),
      before: before.toString().slice(-64),
      after: after.toString().slice(0, 64),
    },
  });
}
