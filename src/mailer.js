/* Mail — EMAIL_MODE env:
     log → stdout te "[DEV MAIL] ..." (production vich sirf ALLOW_OTP_LOG=yes naal)
     ses → AWS SES v2 (region AWS_REGION, From EMAIL_FROM, credentials default chain / instance role)
   Dev vich EMAIL_MODE khali = log. Production vich khali/galat = status().ok false →
   reader signup/forgot 503 dinde ne, baaki server chalda rehnda. */

const isProd = () => process.env.NODE_ENV === 'production';
const rawMode = () => String(process.env.EMAIL_MODE || '').trim().toLowerCase();

class MailConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailConfigError';
  }
}

function status() {
  const mode = rawMode();
  if (!mode) return isProd() ? { ok: false, reason: 'EMAIL_MODE is not set' } : { ok: true, mode: 'log' };
  if (mode === 'log') {
    if (isProd() && process.env.ALLOW_OTP_LOG !== 'yes')
      return { ok: false, mode, reason: 'EMAIL_MODE=log is refused in production unless ALLOW_OTP_LOG=yes' };
    return { ok: true, mode };
  }
  if (mode === 'ses') {
    if (!process.env.EMAIL_FROM) return { ok: false, mode, reason: 'EMAIL_FROM is not set' };
    return { ok: true, mode };
  }
  return { ok: false, reason: `EMAIL_MODE "${mode}" is unknown (use log or ses)` };
}

let sesClient;
function ses() {
  if (!sesClient) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    sesClient = new SESv2Client({ region: process.env.AWS_REGION || 'ap-south-1' });
  }
  return sesClient;
}

async function sendMail({ to, subject, text, html }) {
  const st = status();
  if (!st.ok) throw new MailConfigError(`Email is not configured: ${st.reason}`);

  if (st.mode === 'log') {
    console.log(`[DEV MAIL] to=${to} subject=${subject} text=${String(text).replace(/\s+/g, ' ').trim()}`);
    return;
  }

  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const content = (data) => ({ Data: data, Charset: 'UTF-8' });
  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: content(subject),
          Body: { Text: content(text), ...(html ? { Html: content(html) } : {}) },
        },
      },
    })
  );
}

function otpEmail(code, purpose) {
  const subject = purpose === 'reset' ? 'Your Chaupal Te Charcha password reset code' : 'Your Chaupal Te Charcha code';
  const text =
    `Your Chaupal Te Charcha code is ${code}. It expires in 10 minutes. ` +
    `If you didn't ask for it, ignore this.`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222">` +
    `<p>Your Chaupal Te Charcha code is</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p>` +
    `<p>It expires in 10 minutes.</p>` +
    `<p style="color:#666">If you didn't ask for it, ignore this.</p></div>`;
  return { subject, text, html };
}

module.exports = { sendMail, status, otpEmail, MailConfigError };
