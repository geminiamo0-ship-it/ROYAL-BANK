import type { AnnotationTextHighlight } from '@/lib/exam-annotations';

export function contentRootFor(layer: HTMLElement | null): HTMLElement | null {
  const parent = layer?.parentElement;
  if (!parent) return null;
  return parent.querySelector<HTMLElement>('[data-annotation-content="true"]');
}

function isIgnoredAnnotationNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return Boolean(element?.closest('[data-annotation-ignore="true"]'));
}

function stripIgnoredAnnotationContent(fragment: DocumentFragment): DocumentFragment {
  fragment.querySelectorAll('[data-annotation-ignore="true"]').forEach((element) => element.remove());
  return fragment;
}

function offsetWithin(root: HTMLElement, node: Node, offset: number): number | null {
  try {
    if (isIgnoredAnnotationNode(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    const fragment = stripIgnoredAnnotationContent(range.cloneContents());
    return fragment.textContent?.length ?? 0;
  } catch {
    return null;
  }
}

function textBoundaryAt(root: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  if (targetOffset < 0) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isIgnoredAnnotationNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let consumed = 0;
  let lastText: Text | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastText = textNode;
    const next = consumed + textNode.data.length;
    if (targetOffset <= next) {
      return {
        node: textNode,
        offset: Math.max(0, Math.min(textNode.data.length, targetOffset - consumed)),
      };
    }
    consumed = next;
  }

  if (lastText && targetOffset === consumed) {
    return { node: lastText, offset: lastText.data.length };
  }
  return null;
}

export function rangeForHighlight(root: HTMLElement, mark: AnnotationTextHighlight): Range | null {
  const start = textBoundaryAt(root, mark.start);
  const end = textBoundaryAt(root, mark.end);
  if (!start || !end) return null;

  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

export function selectedTextOffsets(root: HTMLElement): { start: number; end: number; quote: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const start = offsetWithin(root, range.startContainer, range.startOffset);
  const end = offsetWithin(root, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;

  const fragment = stripIgnoredAnnotationContent(range.cloneContents());
  const quote = fragment.textContent || '';
  if (!quote.trim()) return null;
  return { start, end, quote: quote.slice(0, 1000) };
}
