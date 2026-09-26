'use client';

import React, { type ReactNode } from 'react';

export type DeepDiveTextDirection = 'ltr' | 'rtl' | 'auto';

type MarkdownSection = {
  title: string | null;
  body: string[];
};

const ARABIC_RE = /[\u0600-\u06FF]/g;
const LATIN_RE = /[A-Za-z]/g;

function textDirection(value: string, preferred: DeepDiveTextDirection): 'ltr' | 'rtl' {
  if (preferred === 'ltr' || preferred === 'rtl') return preferred;
  const arabic = (value.match(ARABIC_RE) || []).length;
  const latin = (value.match(LATIN_RE) || []).length;
  return arabic > 0 && arabic >= Math.max(2, Math.floor(latin * 0.2)) ? 'rtl' : 'ltr';
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://royal-bank-five.vercel.app');
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function inlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const tokenRe = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^\s)]+\))/g;
  const parts = value.split(tokenRe).filter(Boolean);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-[#2b261f] dark:text-[#fff8e8]">
          <bdi dir="auto">{part.slice(2, -2)}</bdi>
        </strong>
      );
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={key}
          dir="ltr"
          className="rounded bg-black/[0.055] px-1 py-0.5 font-mono text-[0.92em] text-[#5f4a22] dark:bg-white/[0.07] dark:text-[#efd497]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (linkMatch) {
      const href = safeHref(linkMatch[2]);
      if (!href) return <React.Fragment key={key}>{linkMatch[1]}</React.Fragment>;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#9a722d] underline decoration-[#c9a75f]/50 underline-offset-2 hover:text-[#79571d] dark:text-[#e1bf72] dark:hover:text-[#efd497]"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      current += char;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim().replace(/\\\|/g, '|'));
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim().replace(/\\\|/g, '|'));
  return cells;
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isList(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
}

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s+/.test(line);
}

function isRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (isFence(line) || isList(line) || isHeading(line) || isRule(line) || /^\s*>\s?/.test(line)) return true;
  return line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]);
}

function MarkdownBlocks({
  lines,
  direction,
}: {
  lines: string[];
  direction: DeepDiveTextDirection;
}) {
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (isFence(raw)) {
      const language = trimmed.replace(/^```/, '').trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <div key={`code-${i}`} className="my-3 overflow-x-auto rounded-xl border border-black/10 bg-[#f2ece1] dark:border-white/8 dark:bg-[#0d1419]">
          {language ? <div className="border-b border-black/8 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#857b6d] dark:border-white/8 dark:text-white/35">{language}</div> : null}
          <pre dir="ltr" className="m-0 min-w-max p-3 font-mono text-[11px] leading-5 text-[#302b24] dark:text-[#dce3e8]"><code>{code.join('\n')}</code></pre>
        </div>,
      );
      continue;
    }

    if (raw.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(raw);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const tableDir = direction === 'rtl' ? 'rtl' : 'ltr';
      nodes.push(
        <div key={`table-${i}`} className="my-4 max-w-full overflow-x-auto rounded-xl border border-black/10 bg-[#fffdf8] shadow-sm dark:border-white/10 dark:bg-[#11191f]">
          <table dir={tableDir} className="w-full min-w-[560px] border-collapse text-[11.5px] leading-5 sm:text-[12px]">
            <thead className="bg-[#f3ecdf] dark:bg-white/[0.045]">
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                    className="border-b border-black/10 px-3 py-2.5 text-start font-semibold text-[#332d24] dark:border-white/10 dark:text-[#fff5df]"
                  >
                    {inlineMarkdown(cell, `th-${i}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-black/[0.065] last:border-b-0 odd:bg-black/[0.012] dark:border-white/[0.065] dark:odd:bg-white/[0.012]">
                  {headers.map((_, cellIndex) => {
                    const cell = row[cellIndex] ?? '';
                    return (
                      <td
                        key={cellIndex}
                        dir="auto"
                        style={{ unicodeBidi: 'plaintext' }}
                        className={"px-3 py-2.5 align-top text-[#5f5a52] dark:text-[#cfd6db] " + (cellIndex === 0 ? 'font-medium text-[#302a22] dark:text-[#f3ead8]' : '')}
                      >
                        {inlineMarkdown(cell, `td-${i}-${rowIndex}-${cellIndex}`)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (isHeading(raw)) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
      const text = match?.[2] ?? trimmed;
      const dir = textDirection(text, direction);
      nodes.push(
        <h4
          key={`heading-${i}`}
          dir={dir}
          style={{ unicodeBidi: 'plaintext' }}
          className="mt-4 text-[13px] font-semibold text-[#9a722d] first:mt-0 dark:text-[#efd497]"
        >
          {inlineMarkdown(text, `heading-${i}`)}
        </h4>,
      );
      i += 1;
      continue;
    }

    if (isRule(raw)) {
      nodes.push(<hr key={`hr-${i}`} className="my-4 border-0 border-t border-black/10 dark:border-white/8" />);
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(raw)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const text = quote.join(' ');
      const dir = textDirection(text, direction);
      nodes.push(
        <blockquote
          key={`quote-${i}`}
          dir={dir}
          style={{ unicodeBidi: 'plaintext' }}
          className="my-3 rounded-xl border border-[#c9a75f]/25 bg-[#c9a75f]/8 px-3.5 py-3 text-[12px] leading-6 text-[#6d572c] dark:bg-[#c9a75f]/10 dark:text-[#ead6a8]"
        >
          {inlineMarkdown(text, `quote-${i}`)}
        </blockquote>,
      );
      continue;
    }

    if (isList(raw)) {
      const ordered = /^\s*\d+[.)]\s+/.test(raw);
      const items: string[] = [];
      while (i < lines.length) {
        const line = lines[i];
        const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
        const match = line.match(pattern);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      nodes.push(
        <ListTag
          key={`list-${i}`}
          className={(ordered ? 'list-decimal ' : 'list-disc ') + 'my-2 space-y-1.5 ps-5 marker:text-[#b98a34]'}
        >
          {items.map((item, index) => (
            <li
              key={index}
              dir={textDirection(item, direction)}
              style={{ unicodeBidi: 'plaintext' }}
              className="text-[12.5px] leading-6 text-[#625c53] dark:text-[#d3d9dd]"
            >
              {inlineMarkdown(item, `li-${i}-${index}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraph: string[] = [trimmed];
    i += 1;
    while (i < lines.length && !startsBlock(lines, i)) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    const text = paragraph.join(' ');
    const dir = textDirection(text, direction);
    nodes.push(
      <p
        key={`p-${i}`}
        dir={dir}
        style={{ unicodeBidi: 'plaintext' }}
        className="my-2 text-[12.5px] leading-6 text-[#625c53] first:mt-0 last:mb-0 dark:text-[#d3d9dd] sm:text-[13px]"
      >
        {inlineMarkdown(text, `p-${i}`)}
      </p>,
    );
  }

  return <>{nodes}</>;
}

function splitSections(content: string): MarkdownSection[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { title: null, body: [] };

  const flush = () => {
    if (current.title || current.body.some((line) => line.trim())) sections.push(current);
    current = { title: null, body: [] };
  };

  for (const raw of lines) {
    const heading = raw.trim().match(/^#{2,4}\s+(.+)$/);
    const boldHeading = raw.trim().match(/^\*\*(\d+\.\s+.+?)\*\*:?\s*$/);
    if (heading || boldHeading) {
      flush();
      current.title = (heading?.[1] ?? boldHeading?.[1] ?? '').trim();
      continue;
    }
    current.body.push(raw);
  }
  flush();

  return sections.length ? sections : [{ title: null, body: lines }];
}

export function DeepDiveMarkdown({
  content,
  direction = 'auto',
  compact = false,
  animateSections = false,
}: {
  content: string;
  direction?: DeepDiveTextDirection;
  compact?: boolean;
  animateSections?: boolean;
}) {
  const sections = splitSections(content);

  return (
    <div className={compact ? '' : 'space-y-3'}>
      {sections.map((section, index) => {
        const sectionText = [section.title ?? '', ...section.body].join(' ');
        const dir = textDirection(sectionText, direction);
        return (
          <section
            key={index}
            dir={dir}
            style={{
              unicodeBidi: 'plaintext',
              animationDelay: animateSections ? `${Math.min(index * 55, 330)}ms` : undefined,
            }}
            className={
              (compact
                ? ''
                : 'rounded-2xl border border-black/[0.085] bg-[#fffdf8] px-4 py-4 shadow-[0_10px_26px_rgba(65,49,22,0.045)] dark:border-white/8 dark:bg-[#151d23] sm:px-5 ') +
              (animateSections ? ' royal-deep-dive-section' : '')
            }
          >
            {section.title ? (
              <div className="mb-2.5 flex items-start gap-2.5">
                <span className="mt-0.5 grid h-6 min-w-6 place-items-center rounded-lg border border-[#c9a75f]/25 bg-[#c9a75f]/8 px-1.5 text-[9px] font-bold text-[#9a722d] dark:text-[#e6c471]">
                  {index + 1}
                </span>
                <h3 className="font-serif text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[#28231d] dark:text-white sm:text-[17px]">
                  {inlineMarkdown(section.title, `section-title-${index}`)}
                </h3>
              </div>
            ) : null}
            <MarkdownBlocks lines={section.body} direction={direction} />
          </section>
        );
      })}
    </div>
  );
}
