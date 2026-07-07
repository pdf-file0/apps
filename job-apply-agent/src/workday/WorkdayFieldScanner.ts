import type { Page } from 'playwright-core'
import { DRAFT_FIELD_ATTR } from './WorkdaySelectors'
import type { ScannedWorkdayField, WorkdayInputType, WorkdayPageScan } from './types'

const MAX_VALUE_CHARS = 200
const MAX_TEXT_CHARS = 200_000

// ---------------------------------------------------------------------------
// Shared helpers (offline HTML parsing — fixture pages only)
// ---------------------------------------------------------------------------

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const stripToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()

const attrValue = (attrs: string, name: string): string | null => {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  if (!match) return null
  return decodeEntities(match[2] ?? match[3] ?? '')
}

const hasBareAttr = (attrs: string, name: string): boolean =>
  new RegExp(`(^|\\s)${name}(\\s|=|/|$)`, 'i').test(attrs)

const cleanLabel = (raw: string): string => stripToText(raw).replace(/\s*\*\s*$/, '').trim()

const normalizeInputType = (raw: string | null, tag: string): WorkdayInputType => {
  if (tag === 'select') return 'select'
  if (tag === 'textarea') return 'textarea'
  const type = (raw ?? 'text').toLowerCase()
  switch (type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'number':
    case 'date':
    case 'radio':
    case 'checkbox':
    case 'file':
    case 'password':
      return type
    case 'search':
      return 'text'
    default:
      return 'unknown'
  }
}

interface RawControl {
  tag: 'input' | 'select' | 'textarea'
  attrs: string
  inner: string
  offset: number
}

interface OffsetText {
  offset: number
  text: string
}

/**
 * Parse the visible form fields out of a Workday-like fixture page. This is
 * the OFFLINE twin of the live in-page scan script below; both produce the
 * same ScannedWorkdayField shape. It intentionally never extracts password
 * values, hidden inputs, cookies, or any storage.
 */
export function scanWorkdayFieldsFromHtml(html: string): ScannedWorkdayField[] {
  // label[for] → text
  const labelByFor = new Map<string, string>()
  const labelRe = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi
  let match: RegExpExecArray | null
  while ((match = labelRe.exec(html)) !== null) {
    const forId = attrValue(match[1] ?? '', 'for')
    if (forId) labelByFor.set(forId, cleanLabel(match[2] ?? ''))
  }

  // section headings with offsets
  const headings: OffsetText[] = []
  const headingRe = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  while ((match = headingRe.exec(html)) !== null) {
    headings.push({ offset: match.index, text: stripToText(match[2] ?? '') })
  }
  const nearestHeading = (offset: number): string | null => {
    let best: string | null = null
    for (const h of headings) {
      if (h.offset < offset) best = h.text
      else break
    }
    return best
  }

  // fieldset ranges with legends (for radio-group labels)
  const fieldsets: { start: number; end: number; legend: string }[] = []
  const fieldsetRe = /<fieldset\b[^>]*>([\s\S]*?)<\/fieldset>/gi
  while ((match = fieldsetRe.exec(html)) !== null) {
    const legendMatch = (match[1] ?? '').match(/<legend\b[^>]*>([\s\S]*?)<\/legend>/i)
    fieldsets.push({
      start: match.index,
      end: match.index + match[0].length,
      legend: legendMatch ? cleanLabel(legendMatch[1] ?? '') : '',
    })
  }
  const enclosingLegend = (offset: number): string | null =>
    fieldsets.find((f) => offset >= f.start && offset <= f.end)?.legend || null

  // help-text targets (aria-describedby="id")
  const helpTextById = (id: string): string | null => {
    const helpMatch = html.match(
      new RegExp(`<(div|p|span)\\b[^>]*id\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)</\\1>`, 'i'),
    )
    return helpMatch ? stripToText(helpMatch[2] ?? '') : null
  }

  // collect raw controls in document order
  const controls: RawControl[] = []
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
  while ((match = selectRe.exec(html)) !== null) {
    controls.push({ tag: 'select', attrs: match[1] ?? '', inner: match[2] ?? '', offset: match.index })
  }
  const textareaRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi
  while ((match = textareaRe.exec(html)) !== null) {
    controls.push({ tag: 'textarea', attrs: match[1] ?? '', inner: match[2] ?? '', offset: match.index })
  }
  const inputRe = /<input\b([^>]*?)\/?>/gi
  while ((match = inputRe.exec(html)) !== null) {
    controls.push({ tag: 'input', attrs: match[1] ?? '', inner: '', offset: match.index })
  }
  controls.sort((a, b) => a.offset - b.offset)

  const fields: ScannedWorkdayField[] = []
  const radioGroups = new Map<string, ScannedWorkdayField & { checkedValue: string | null }>()
  let syntheticIndex = 0

  for (const control of controls) {
    const { attrs } = control
    const typeAttr = attrValue(attrs, 'type')
    const style = attrValue(attrs, 'style') ?? ''
    if ((typeAttr ?? '').toLowerCase() === 'hidden') continue
    if (hasBareAttr(attrs, 'hidden') || /display\s*:\s*none/i.test(style)) continue
    const inputType = normalizeInputType(typeAttr, control.tag)
    if (control.tag === 'input' && (typeAttr ?? '').toLowerCase() === 'submit') continue
    if (control.tag === 'input' && (typeAttr ?? '').toLowerCase() === 'button') continue

    const domId = attrValue(attrs, 'id')
    const name = attrValue(attrs, 'name')
    const ariaLabel = attrValue(attrs, 'aria-label')
    const placeholder = attrValue(attrs, 'placeholder')
    const automationId = attrValue(attrs, 'data-automation-id')
    const describedBy = attrValue(attrs, 'aria-describedby')
    const labelFromFor = domId ? (labelByFor.get(domId) ?? null) : null
    const required =
      hasBareAttr(attrs, 'required') ||
      attrValue(attrs, 'aria-required') === 'true' ||
      /\*\s*$/.test(domId ? (labelByFor.get(domId) ?? '') : '')
    const helpText = describedBy ? helpTextById(describedBy) : null
    const sectionHeading = nearestHeading(control.offset)

    if (inputType === 'radio') {
      const groupKey = name ?? domId ?? `radio-${syntheticIndex++}`
      const optionLabel = labelFromFor ?? attrValue(attrs, 'value') ?? ''
      const checked = hasBareAttr(attrs, 'checked')
      const existing = radioGroups.get(groupKey)
      if (existing) {
        if (optionLabel) existing.options.push(optionLabel)
        if (checked) existing.checkedValue = optionLabel
        existing.currentValue = existing.checkedValue
        continue
      }
      const group: ScannedWorkdayField & { checkedValue: string | null } = {
        fieldId: groupKey,
        label: enclosingLegend(control.offset) ?? labelFromFor ?? ariaLabel ?? groupKey,
        inputType: 'radio',
        name,
        domId: null,
        automationId,
        ariaLabel,
        placeholder: null,
        currentValue: checked ? optionLabel : null,
        required,
        options: optionLabel ? [optionLabel] : [],
        helpText,
        sectionHeading,
        checkedValue: checked ? optionLabel : null,
      }
      radioGroups.set(groupKey, group)
      fields.push(group)
      continue
    }

    let options: string[] = []
    let currentValue: string | null = null
    if (control.tag === 'select') {
      const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
      let optionMatch: RegExpExecArray | null
      while ((optionMatch = optionRe.exec(control.inner)) !== null) {
        const text = stripToText(optionMatch[2] ?? '')
        if (text) options.push(text)
        if (hasBareAttr(optionMatch[1] ?? '', 'selected')) currentValue = text
      }
      options = options.filter((o) => !/^(select one|please select|choose one|--)/i.test(o))
    } else if (control.tag === 'textarea') {
      currentValue = stripToText(control.inner).slice(0, MAX_VALUE_CHARS) || null
    } else if (inputType === 'checkbox') {
      currentValue = hasBareAttr(attrs, 'checked') ? 'checked' : 'unchecked'
    } else if (inputType === 'password') {
      currentValue = null // NEVER capture password values
    } else if (inputType !== 'file') {
      currentValue = (attrValue(attrs, 'value') ?? '').slice(0, MAX_VALUE_CHARS) || null
    }

    fields.push({
      fieldId: domId ?? name ?? `field-${syntheticIndex++}`,
      label: labelFromFor ?? ariaLabel ?? placeholder ?? (name ? name.replace(/[_-]+/g, ' ') : `unlabeled field ${fields.length}`),
      inputType,
      name,
      domId,
      automationId,
      ariaLabel,
      placeholder,
      currentValue,
      required,
      options,
      helpText,
      sectionHeading,
    })
  }

  return fields.map(({ ...field }) => {
    // strip the internal checkedValue helper property from radio groups
    delete (field as Record<string, unknown>)['checkedValue']
    return field
  })
}

/** Offline page scan for fixture HTML — the fixture twin of scanWorkdayPage. */
export function scanWorkdayPageFromHtml(html: string, url: string): WorkdayPageScan {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const buttons: string[] = []
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi
  let match: RegExpExecArray | null
  while ((match = buttonRe.exec(html)) !== null) {
    const text = stripToText(match[2] ?? '')
    if (text) buttons.push(text)
  }
  const inputButtonRe = /<input\b([^>]*)\/?>/gi
  while ((match = inputButtonRe.exec(html)) !== null) {
    const attrs = match[1] ?? ''
    const type = (attrValue(attrs, 'type') ?? '').toLowerCase()
    if (type === 'submit' || type === 'button') {
      const value = attrValue(attrs, 'value')
      if (value) buttons.push(value)
    }
  }
  return {
    url,
    title: titleMatch ? stripToText(titleMatch[1] ?? '') : '',
    text: stripToText(bodyMatch ? (bodyMatch[1] ?? '') : html).slice(0, MAX_TEXT_CHARS),
    buttons,
    signals: {
      passwordFieldCount: (html.match(/<input[^>]*type\s*=\s*["']?password/gi) ?? []).length,
      fileInputCount: (html.match(/<input[^>]*type\s*=\s*["']?file/gi) ?? []).length,
      captchaDetected: /recaptcha|hcaptcha|turnstile|data-sitekey/i.test(html),
      formFieldCount: (html.match(/<(input|select|textarea)\b/gi) ?? []).length,
    },
    fields: scanWorkdayFieldsFromHtml(html),
  }
}

// ---------------------------------------------------------------------------
// Live in-page scan (string script — see pageText.ts for why not a function)
// ---------------------------------------------------------------------------

const LIVE_SCAN_SCRIPT = `
(() => {
  const ATTR = '${DRAFT_FIELD_ATTR}';
  const MAX_VALUE = ${MAX_VALUE_CHARS};
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, '').trim();
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const labelFor = (el) => {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return clean(label.innerText);
    }
    const wrapping = el.closest('label');
    if (wrapping) return clean(wrapping.innerText);
    return null;
  };
  const legendFor = (el) => {
    const fieldset = el.closest('fieldset');
    if (!fieldset) return null;
    const legend = fieldset.querySelector('legend');
    return legend ? clean(legend.innerText) : null;
  };
  const headingFor = (el) => {
    let node = el;
    while (node && node !== document.body) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^H[23]$/.test(sib.tagName)) return clean(sib.innerText);
        const inner = sib.querySelector && sib.querySelector('h2, h3');
        if (inner) return clean(inner.innerText);
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return null;
  };
  const helpFor = (el) => {
    const ref = el.getAttribute('aria-describedby');
    if (!ref) return null;
    const target = document.getElementById(ref.split(/\\s+/)[0]);
    return target ? clean(target.innerText) : null;
  };
  const normalizeType = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (['text','email','tel','url','number','date','radio','checkbox','file','password'].includes(t)) return t;
    if (t === 'search') return 'text';
    return 'unknown';
  };

  const controls = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter((el) => (el.getAttribute('type') || '').toLowerCase() !== 'hidden')
    .filter((el) => !['submit','button','image','reset'].includes((el.getAttribute('type') || '').toLowerCase()))
    .filter(isVisible);

  const fields = [];
  const radioGroups = new Map();
  let index = 0;

  for (const el of controls) {
    const inputType = normalizeType(el);
    const domId = el.id || null;
    const name = el.getAttribute('name');
    const ariaLabel = el.getAttribute('aria-label');
    const placeholder = el.getAttribute('placeholder');
    const automationId = el.getAttribute('data-automation-id');
    const required = el.required === true || el.getAttribute('aria-required') === 'true';
    const label = labelFor(el);

    if (inputType === 'radio') {
      const groupKey = name || domId || ('radio-' + index++);
      const optionLabel = label || el.value || '';
      el.setAttribute(ATTR, groupKey + '::' + optionLabel);
      const existing = radioGroups.get(groupKey);
      if (existing) {
        if (optionLabel) existing.options.push(optionLabel);
        if (el.checked) existing.currentValue = optionLabel;
        continue;
      }
      const group = {
        fieldId: groupKey,
        label: legendFor(el) || label || ariaLabel || groupKey,
        inputType: 'radio',
        name: name || null,
        domId: null,
        automationId,
        ariaLabel,
        placeholder: null,
        currentValue: el.checked ? optionLabel : null,
        required,
        options: optionLabel ? [optionLabel] : [],
        helpText: helpFor(el),
        sectionHeading: headingFor(el),
      };
      radioGroups.set(groupKey, group);
      fields.push(group);
      continue;
    }

    const fieldId = domId || name || ('field-' + index++);
    el.setAttribute(ATTR, fieldId);
    let options = [];
    let currentValue = null;
    if (inputType === 'select') {
      options = Array.from(el.options).map((o) => clean(o.innerText)).filter(Boolean)
        .filter((o) => !/^(select one|please select|choose one|--)/i.test(o));
      const selected = el.options[el.selectedIndex];
      currentValue = selected ? clean(selected.innerText) : null;
    } else if (inputType === 'checkbox') {
      currentValue = el.checked ? 'checked' : 'unchecked';
    } else if (inputType === 'password') {
      currentValue = null; // NEVER capture password values
    } else if (inputType !== 'file') {
      currentValue = (el.value || '').slice(0, MAX_VALUE) || null;
    }

    fields.push({
      fieldId,
      label: label || ariaLabel || placeholder || (name ? name.replace(/[_-]+/g, ' ') : 'unlabeled field ' + fields.length),
      inputType,
      name: name || null,
      domId,
      automationId,
      ariaLabel,
      placeholder,
      currentValue,
      required,
      options,
      helpText: helpFor(el),
      sectionHeading: headingFor(el),
    });
  }

  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
    .filter(isVisible)
    .map((el) => clean(el.innerText || el.value || el.getAttribute('aria-label') || ''))
    .filter(Boolean)
    .slice(0, 100);

  return {
    url: window.location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, ${MAX_TEXT_CHARS}),
    buttons,
    signals: {
      passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      captchaDetected: document.querySelector(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, [data-sitekey]'
      ) !== null,
      formFieldCount: document.querySelectorAll('form input, form select, form textarea').length,
    },
    fields,
  };
})()
`

/**
 * Live scan: stamps every visible field with ${DRAFT_FIELD_ATTR} so a later
 * plan action can target exactly the element that was scanned. Read-only —
 * it never reads cookies or any browser storage, and never captures
 * password values.
 */
export async function scanWorkdayPage(page: Page): Promise<WorkdayPageScan> {
  return (await page.evaluate(LIVE_SCAN_SCRIPT)) as WorkdayPageScan
}
