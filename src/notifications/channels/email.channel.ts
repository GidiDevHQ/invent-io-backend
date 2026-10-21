import { Injectable } from '@nestjs/common';
import type { ChannelName, MessageChannel, OutboundMessage, SendResult } from './message-channel';

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

/** Minimalist black-and-white email shell. Inline styles only (email clients). */
function htmlShell(body: string): string {
    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr><td align="center" style="padding:48px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
          <tr><td style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#000000;">
            <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#000000;padding-bottom:20px;border-bottom:1px solid #000000;">Invent-IO</div>
            <div style="font-size:16px;line-height:1.6;color:#111111;padding:28px 0;">${escapeHtml(body)}</div>
            <div style="font-size:12px;color:#999999;border-top:1px solid #eeeeee;padding-top:16px;">Automated notification · Invent-IO</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * Brevo (formerly Sendinblue) transactional email API. Note Brevo authenticates
 * with an `api-key` header (not Bearer). Uses global fetch — no extra dependency.
 */
@Injectable()
export class EmailChannel implements MessageChannel {
    readonly name: ChannelName = 'email';

    private config() {
        const apiKey = process.env.EMAIL_API_KEY;
        const fromEmail = process.env.EMAIL_FROM ?? 'no-reply@invent-io.example';
        const fromName = process.env.EMAIL_FROM_NAME ?? 'Invent-IO';
        if (!apiKey) {
            throw new Error('Email is not configured (EMAIL_API_KEY)');
        }
        return { apiKey, fromEmail, fromName };
    }

    async send(message: OutboundMessage): Promise<SendResult> {
        const { apiKey, fromEmail, fromName } = this.config();
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                sender: { email: fromEmail, name: fromName },
                to: [{ email: message.to }],
                subject: message.subject ?? 'Invent-IO notification',
                htmlContent: htmlShell(message.body),
                textContent: message.body, // plain-text fallback
            }),
        });

        const data = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
        if (!res.ok) {
            throw new Error(data.message ?? `Email send failed (${res.status})`);
        }
        return { providerMessageId: data.messageId };
    }
}
