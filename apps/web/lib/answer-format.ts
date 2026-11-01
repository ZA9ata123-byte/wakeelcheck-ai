/**
 * عرض الإجابة — بنيتها لا كلماتها.
 *
 * المحرّك يجيب بـMarkdown: قوائم بشرطات، وروابط «([موقع](رابط))»، وعريض.
 * عرضُه نصّاً خاماً أظهر الرموز وقلب السطور المختلطة عربياً وإنجليزياً.
 * هنا يُقرأ الشكل فقط: كلّ كلمةٍ من الإجابة تبقى كما هي (القاعدة 05) —
 * والرابط يُعرض بموقعه، وهو نصّه الظاهر أصلاً.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'cite'; label: string; href: string };

export type Block = { kind: 'p'; inline: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] };

const LINK = /\(?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\)?|\*\*([^*]+)\*\*/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: line.slice(last, at) });
    if (m[3] !== undefined) out.push({ kind: 'strong', text: m[3] });
    else out.push({ kind: 'cite', label: m[1] ?? '', href: m[2] ?? '' });
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out.filter((p) => p.kind !== 'text' || p.text.trim() !== '');
}

const BULLET = /^\s*[-•*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const bullet = BULLET.test(line);
    const numbered = !bullet && NUMBERED.test(line);
    if (bullet || numbered) {
      const item = parseInline(line.replace(bullet ? BULLET : NUMBERED, ''));
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'list' && prev.ordered === numbered) prev.items.push(item);
      else blocks.push({ kind: 'list', ordered: numbered, items: [item] });
      continue;
    }
    // سطرٌ يبدأ «- » داخل فقرة ملتصقة: ChatGPT يجمع القائمة أحياناً في سطرٍ واحد.
    const inlineItems = line.split(/\s+-\s+(?=\S)/);
    if (inlineItems.length > 2) {
      const [lead, ...items] = inlineItems;
      if (lead !== undefined && lead.trim() !== '') blocks.push({ kind: 'p', inline: parseInline(lead) });
      blocks.push({ kind: 'list', ordered: false, items: items.map(parseInline) });
      continue;
    }
    blocks.push({ kind: 'p', inline: parseInline(line) });
  }
  return blocks;
}

/** موقع الرابط بلا www — ما يُعرض على الزرّ. */
export function citeHost(href: string, label: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return label;
  }
}
