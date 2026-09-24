const sanitizeHtml = require('sanitize-html');

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90) || 'post';

/* Express async route wrapper */
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Editor (TipTap) output ke liye allowed HTML — wahi tags jo studio editor banata hai */
function cleanBody(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: [
      'p', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a', 'b', 'strong', 'i', 'em',
      'u', 's', 'br', 'hr', 'img', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'figure', 'figcaption',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      span: ['style'],
      p: ['style'],
      h2: ['id'],
      h3: ['id'],
      table: ['class'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https'],
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb/, /^transparent$/],
        'font-size': [/^\d{1,2}(\.\d+)?px$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'text-align': [/^(left|center|right)$/],
      },
    },
  });
}

/* h2 headings ko ids do + TOC array banao (article page sidebar iske se banta hai) */
function injectToc(html) {
  const toc = [];
  const out = String(html || '').replace(/<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (m, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = slugify(text);
    if (toc.some((t) => t.id === id)) id = `${id}-${toc.length + 1}`;
    toc.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

module.exports = { slugify, a, cleanBody, injectToc };
