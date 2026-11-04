/**
 * Invent-IO email layout and building blocks.
 *
 *  • Thin teal accent bar on top of a white card, on a warm stone background
 *  • Table-based layout (Outlook-safe), inline styles only
 *  • Colours match the web app (frontend/public/style.css)
 *
 * Templates (templates.ts) compose these into the HTML part of an email; the
 * plain-text body stays the source for WhatsApp, Web Push and the text fallback.
 */

const APP = () => (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// ── Brand tokens (from the web app) ──────────────────────────────────────────
const TEAL = '#0b6358';
const TEAL_DARK = '#084a42';
const TEAL_LIGHT = '#14907f';
const GRAD = `linear-gradient(135deg,${TEAL_DARK} 0%,${TEAL} 55%,${TEAL_LIGHT} 100%)`;
const SELECTED = '#e4f3f1';
const BG = '#f5f5f4';
const BORDER = '#e7e5e4';
const SUBTLE = '#fafaf9';
const TEXT = '#1c1917';
const BODY = '#44403c';
const MUTED = '#57534e';
const FAINT = '#a8a29e';
const RED = '#b91c1c';
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const DEFAULT_FOOTER_NOTE =
    'You are receiving this because you have an Invent-IO account. Reply to this email with any questions.';

/** Makes text safe to place inside an email. Use on every value that came from data. */
export function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Wraps a body in the full branded email. `footerNote` replaces the closing line. */
export function shell(body: string, footerNote: string = DEFAULT_FOOTER_NOTE): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Invent-IO</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:48px 16px 64px;">
  <tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

    <!-- Accent bar -->
    <tr>
      <td bgcolor="${TEAL}" height="4" style="background:${GRAD};border-radius:8px 8px 0 0;font-size:0;line-height:0;">&nbsp;</td>
    </tr>

    <!-- Wordmark -->
    <tr>
      <td style="background:#ffffff;padding:28px 40px 24px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:${TEXT};">Invent</span><span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:${TEAL};">-IO</span>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="font-size:10px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:${MUTED};">Payment-triggered inventory</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Rule -->
    <tr>
      <td style="background:#ffffff;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:0 40px;">
        <div style="height:1px;background:${BORDER};"></div>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="background:#ffffff;padding:36px 40px 40px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
        ${body}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:${SUBTLE};border:1px solid ${BORDER};border-top:none;border-radius:0 0 8px 8px;padding:20px 40px;">
        <p style="margin:0 0 6px;font-size:11px;color:${FAINT};line-height:1.8;text-align:center;">
          Invent-IO &nbsp;·&nbsp;
          <a href="${appUrl()}" style="color:${FAINT};text-decoration:none;">Open the app</a>
        </p>
        <p style="margin:0;font-size:10px;color:${FAINT};line-height:1.7;text-align:center;">
          ${footerNote}
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Link to a screen in the web app. The frontend uses hash routing, so the route
 * goes after `#/`: appUrl('sales') → https://app/#/sales.
 */
export function appUrl(route = '', query?: Record<string, string>): string {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    return `${APP()}/#/${route}${qs}`;
}

// ── Primitives ────────────────────────────────────────────────────────────────

export function label(text: string): string {
    return `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${TEAL};">${text}</p>`;
}

export function h1(text: string): string {
    return `<h1 style="margin:0 0 20px;font-size:24px;font-weight:800;color:${TEXT};letter-spacing:-0.5px;line-height:1.25;">${text}</h1>`;
}

export function p(text: string): string {
    return `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:${BODY};">${text}</p>`;
}

export function pSmall(text: string): string {
    return `<p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">${text}</p>`;
}

export function greeting(name?: unknown): string {
    const who = typeof name === 'string' && name.trim() ? name : 'there';
    return `<p style="margin:0 0 24px;font-size:15px;color:${BODY};">Hi <strong style="color:${TEXT};">${esc(who)}</strong>,</p>`;
}

export function divider(): string {
    return `<div style="height:1px;background:${BORDER};margin:28px 0;"></div>`;
}

/** Call-to-action button; Outlook falls back to the solid bgcolor. */
export function btn(text: string, href: string): string {
    return `<table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
    <tr>
      <td bgcolor="${TEAL}" style="background:${GRAD};border-radius:6px;">
        <a href="${esc(href)}" style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.2px;border-radius:6px;">${text}</a>
      </td>
    </tr>
  </table>`;
}

/** The raw link under a button, for clients that block buttons. */
export function fallbackLink(href: string): string {
    return pSmall(
        `Button not working? Paste this link into your browser:<br><a href="${esc(href)}" style="color:${TEAL};word-break:break-all;">${esc(href)}</a>`,
    );
}

/** Borderless key/value row for infoTable. */
export function row(key: string, value: string, last = false): string {
    const line = last ? '' : `border-bottom:1px solid ${BORDER};`;
    return `<tr>
    <td style="padding:11px 0;${line}font-size:12px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;color:${MUTED};width:36%;vertical-align:top;">${key}</td>
    <td style="padding:11px 0 11px 20px;${line}font-size:14px;font-weight:500;color:${TEXT};vertical-align:top;">${value}</td>
  </tr>`;
}

export function infoTable(rows: string[]): string {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 28px;">
    ${rows.join('')}
  </table>`;
}

/** A large figure, e.g. an amount. */
export function amount(text: string, tone: 'brand' | 'error' = 'brand'): string {
    return `<strong style="font-size:16px;color:${tone === 'error' ? RED : TEAL};">${text}</strong>`;
}

/** Inline status pill. */
export function badge(text: string, type: 'success' | 'warning' | 'error' | 'neutral'): string {
    const map = {
        success: { bg: SELECTED, color: TEAL },
        warning: { bg: '#fef3c7', color: '#92400e' },
        error: { bg: '#fee2e2', color: RED },
        neutral: { bg: '#eeedeb', color: MUTED },
    };
    const s = map[type];
    return `<span style="display:inline-block;background:${s.bg};color:${s.color};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${text}</span>`;
}

/** Subtle notice strip with a coloured left edge. */
export function notice(text: string, type: 'info' | 'warning' | 'error'): string {
    const map = {
        info: { bg: SELECTED, left: TEAL, color: TEAL_DARK },
        warning: { bg: '#fffbeb', left: '#d97706', color: '#92400e' },
        error: { bg: '#fef2f2', left: RED, color: '#7f1d1d' },
    };
    const s = map[type];
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
    <tr>
      <td style="background:${s.bg};border-left:3px solid ${s.left};border-radius:0 4px 4px 0;padding:12px 16px;font-size:13px;line-height:1.55;color:${s.color};">${text}</td>
    </tr>
  </table>`;
}

/** A one-time code shown as separate digit boxes. */
export function codeDigits(code: string): string {
    const cells = code
        .split('')
        .map(
            (d) =>
                `<td style="width:44px;height:54px;text-align:center;vertical-align:middle;background:${SELECTED};border:1.5px solid #b6dcd6;border-radius:6px;font-size:26px;font-weight:700;color:${TEAL};font-family:${FONT};">${esc(d)}</td>`,
        )
        .join('<td style="width:8px;"></td>');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;"><tr>${cells}</tr></table>`;
}

/** Simple bulleted list. Items must already be escaped. */
export function list(items: string[]): string {
    if (items.length === 0) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
    ${items
        .map(
            (i) =>
                `<tr><td style="width:18px;vertical-align:top;padding:4px 0;color:${TEAL};font-size:15px;line-height:1.5;">&bull;</td><td style="padding:4px 0;font-size:14px;line-height:1.5;color:${BODY};">${i}</td></tr>`,
        )
        .join('')}
  </table>`;
}
