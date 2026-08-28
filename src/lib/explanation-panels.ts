interface HtmlDivSegment {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  innerHtml: string;
  openTag: string;
}

interface ExtractedExplanationPanels {
  contentHtml: string;
  sidebarHtml: string | null;
  conceptHtml: string | null;
  conceptImageHtml: string | null;
}

interface ConceptInlineToolsResult {
  contentHtml: string;
  detailsBodyHtml: string | null;
}

function findTagEnd(html: string, start: number) {
  let quote: string | null = null;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index + 1;
    }
  }

  return -1;
}

function isOpeningDivAt(html: string, index: number) {
  const maybeDiv = html.slice(index, index + 4).toLowerCase();
  const nextChar = html[index + 4] || '';
  return maybeDiv === '<div' && (nextChar === '>' || /\s/.test(nextChar));
}

function isClosingDivAt(html: string, index: number) {
  return /^<\/div\s*>/i.test(html.slice(index, index + 8));
}

function findMatchingDiv(html: string, start: number): HtmlDivSegment | null {
  const openEnd = findTagEnd(html, start);
  if (openEnd === -1) {
    return null;
  }

  let depth = 0;
  let index = start;
  const lowerHtml = html.toLowerCase();

  while (index < html.length) {
    const nextOpen = lowerHtml.indexOf('<div', index);
    const nextClose = lowerHtml.indexOf('</div', index);

    if (nextOpen === -1 && nextClose === -1) {
      return null;
    }

    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      if (!isOpeningDivAt(html, nextOpen)) {
        index = nextOpen + 4;
        continue;
      }

      const nextOpenEnd = findTagEnd(html, nextOpen);
      if (nextOpenEnd === -1) {
        return null;
      }

      depth += 1;
      index = nextOpenEnd;
      continue;
    }

    if (!isClosingDivAt(html, nextClose)) {
      index = nextClose + 6;
      continue;
    }

    const closeEnd = findTagEnd(html, nextClose);
    if (closeEnd === -1) {
      return null;
    }

    depth -= 1;

    if (depth === 0) {
      return {
        start,
        openEnd,
        closeStart: nextClose,
        end: closeEnd,
        innerHtml: html.slice(openEnd, nextClose),
        openTag: html.slice(start, openEnd),
      };
    }

    index = closeEnd;
  }

  return null;
}

function hasInlineStyle(openTag: string, fragments: string[]) {
  const compactTag = openTag.toLowerCase().replace(/\s+/g, '');
  return fragments.every((fragment) => compactTag.includes(fragment.toLowerCase().replace(/\s+/g, '')));
}

function findDivByStyle(html: string, fragments: string[]) {
  const lowerHtml = html.toLowerCase();
  let index = 0;

  while (index < html.length) {
    const nextOpen = lowerHtml.indexOf('<div', index);
    if (nextOpen === -1) {
      return null;
    }

    if (!isOpeningDivAt(html, nextOpen)) {
      index = nextOpen + 4;
      continue;
    }

    const openEnd = findTagEnd(html, nextOpen);
    if (openEnd === -1) {
      return null;
    }

    const openTag = html.slice(nextOpen, openEnd);
    if (hasInlineStyle(openTag, fragments)) {
      return findMatchingDiv(html, nextOpen);
    }

    index = openEnd;
  }

  return null;
}

function extractFirstImageHtml(html: string) {
  return html.match(/<img\b[^>]*>/i)?.[0] || null;
}

function extractConceptSummaryHtml(conceptBlockHtml: string) {
  const summary = findDivByStyle(conceptBlockHtml, ['font-size:0.95rem', 'color:#134e4a']);
  return summary?.innerHtml.trim() || null;
}

function extractConceptDetailsBody(detailsHtml: string) {
  const body = findDivByStyle(detailsHtml, ['margin-top:8px', 'padding-top:8px', 'border-top:1px dashed #b3dbc9']);
  const fallbackBody = detailsHtml
    .replace(/^<details\b[^>]*>/i, '')
    .replace(/<\/details>\s*$/i, '')
    .replace(/<summary\b[\s\S]*?<\/summary>/i, '')
    .trim();

  return body?.innerHtml.trim() || fallbackBody || null;
}

function removeConceptInlineTools(conceptHtml: string): ConceptInlineToolsResult {
  const conceptDetailsPattern =
    /<details\s+style=["'][^"']*margin-top\s*:\s*10px;[^"']*font-size\s*:\s*0\.85rem;[^"']*color\s*:\s*#2c5240;?[^"']*["']>[\s\S]*?<\/details>/i;
  const detailsMatch = conceptHtml.match(conceptDetailsPattern);

  return {
    contentHtml: conceptHtml
    .replace(
      /<div\s+style=["'][^"']*display\s*:\s*flex;[^"']*align-items\s*:\s*center;[^"']*gap\s*:\s*16px;[^"']*font-size\s*:\s*0\.78rem;?[^"']*["']>[\s\S]*?Important for me[\s\S]*?Less important[\s\S]*?<\/div>/i,
      ''
    )
    .replace(conceptDetailsPattern, ''),
    detailsBodyHtml: detailsMatch ? extractConceptDetailsBody(detailsMatch[0]) : null,
  };
}

function buildConceptControlsHtml(isConceptBookmarked: boolean, detailsBodyHtml: string | null) {
  const conceptDetailsHtml = detailsBodyHtml
    ? `<details class="pm-inline-concept-details"><summary>View Concept Explanation</summary><div class="pm-inline-concept-details-body">${detailsBodyHtml}</div></details>`
    : '';

  return `<div class="pm-inline-concept-actions"><button type="button" data-concept-bookmark="true" aria-pressed="${isConceptBookmarked ? 'true' : 'false'}">${isConceptBookmarked ? 'Bookmarked' : 'Bookmark concept'}</button>${conceptDetailsHtml}<button type="button" data-concept-deep-dive="true">Deep dive &rsaquo;</button></div>`;
}

function transformEmbeddedConceptBlocks(html: string, isConceptBookmarked: boolean) {
  let output = '';
  let cursor = 0;
  let conceptHtml: string | null = null;
  let conceptImageHtml: string | null = null;

  while (cursor < html.length) {
    const nextConceptBlock = findDivByStyle(html.slice(cursor), ['background:#dbece5', 'border:1px solid #b3dbc9']);

    if (!nextConceptBlock) {
      output += html.slice(cursor);
      break;
    }

    const start = cursor + nextConceptBlock.start;
    const openEnd = cursor + nextConceptBlock.openEnd;
    const closeStart = cursor + nextConceptBlock.closeStart;
    const end = cursor + nextConceptBlock.end;
    const innerHtml = html.slice(openEnd, closeStart);

    if (!conceptHtml) {
      conceptHtml = extractConceptSummaryHtml(innerHtml);
    }

    if (!conceptImageHtml) {
      conceptImageHtml = extractFirstImageHtml(innerHtml);
    }

    output += html.slice(cursor, start);
    output += html.slice(start, openEnd);
    const inlineTools = removeConceptInlineTools(innerHtml);

    output += inlineTools.contentHtml;
    output += buildConceptControlsHtml(isConceptBookmarked, inlineTools.detailsBodyHtml);
    output += html.slice(closeStart, end);
    cursor = end;
  }

  return {
    contentHtml: output,
    conceptHtml,
    conceptImageHtml,
  };
}

export function extractExplanationPanels(html: string, isConceptBookmarked = false): ExtractedExplanationPanels {
  if (!html) {
    return {
      contentHtml: '',
      sidebarHtml: null,
      conceptHtml: null,
      conceptImageHtml: null,
    };
  }

  const sidebar = findDivByStyle(html, ['width:300px', 'flex-shrink:0']);
  if (!sidebar) {
    const transformed = transformEmbeddedConceptBlocks(html, isConceptBookmarked);

    return {
      contentHtml: transformed.contentHtml.trim(),
      sidebarHtml: null,
      conceptHtml: transformed.conceptHtml,
      conceptImageHtml: transformed.conceptImageHtml,
    };
  }

  let contentHtml = `${html.slice(0, sidebar.start)}${html.slice(sidebar.end)}`;
  const flexWrapper = findDivByStyle(contentHtml, ['display:flex']);

  if (flexWrapper) {
    const mainPane = findDivByStyle(flexWrapper.innerHtml, ['flex:1', 'min-width:300px']);

    if (mainPane) {
      const leftover = `${flexWrapper.innerHtml.slice(0, mainPane.start)}${flexWrapper.innerHtml.slice(mainPane.end)}`
        .replace(/<br\s*\/?>/gi, '')
        .trim();

      if (!leftover) {
        contentHtml = `${contentHtml.slice(0, flexWrapper.start)}${mainPane.innerHtml}${contentHtml.slice(flexWrapper.end)}`;
      }
    }
  }

  const transformed = transformEmbeddedConceptBlocks(contentHtml, isConceptBookmarked);

  return {
    contentHtml: transformed.contentHtml.trim(),
    sidebarHtml: sidebar.innerHtml.trim() || null,
    conceptHtml: transformed.conceptHtml,
    conceptImageHtml: transformed.conceptImageHtml,
  };
}

// force rebuild 1
