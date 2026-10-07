/* Mail — EMAIL_MODE env:
     log  → stdout te "[DEV MAIL] ..." (production vich sirf ALLOW_OTP_LOG=yes naal)
     smtp → nodemailer, ik pooled transport (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS)
     ses  → AWS SES v2 (region AWS_REGION, From EMAIL_FROM, credentials default chain / instance role)
   Dev vich EMAIL_MODE khali = log. Production vich khali/galat = status().configured false →
   reader signup/forgot 503 dinde ne, baaki server chalda rehnda.
   Env har call te padhe jaande ne; values (khaas kar SMTP_PASS) kade log nahi hundiyan — sirf variable NAMES. */

const crypto = require('crypto');

const isProd = () => process.env.NODE_ENV === 'production';
const rawMode = () => String(process.env.EMAIL_MODE || '').trim().toLowerCase();
const env = (k) => String(process.env[k] || '').trim();

class MailConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailConfigError';
  }
}

/* "Chaupal Te Charcha <name@domain>" → "name@domain" (envelope sender) */
function fromAddress(from) {
  const m = String(from || '').match(/<([^<>\s]+@[^<>\s]+)>\s*$/);
  const addr = m ? m[1] : String(from || '').trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr) ? addr : null;
}

/* SMTP config ya missing/invalid variable NAMES */
function smtpConfig() {
  const missing = [];
  const host = env('SMTP_HOST');
  const secure = env('SMTP_SECURE').toLowerCase() === 'true';
  const portRaw = env('SMTP_PORT');
  /* SMTP_SECURE=true te port na ditta hove ta 465 (implicit TLS), nahi ta 587 (STARTTLS) */
  const port = portRaw ? Number(portRaw) : secure ? 465 : 587;
  const user = env('SMTP_USER');
  const pass = process.env.SMTP_PASS || '';
  const from = env('EMAIL_FROM');
  if (!host) missing.push('SMTP_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!pass || pass === 'CHANGE_ME') missing.push('SMTP_PASS');
  if (!fromAddress(from)) missing.push('EMAIL_FROM');
  /* EHLO naam: SMTP_HELO_NAME, nahi ta EMAIL_FROM da domain (default "[127.0.0.1]" kai servers reject karde, e.g. Rediffmail "550 Invalid HeloHost") */
  const heloName = env('SMTP_HELO_NAME') || (fromAddress(from) || '').split('@')[1] || '';
  return { missing, host, port, secure, user, pass, from, heloName, replyTo: env('EMAIL_REPLY_TO') };
}

/* {mode, configured, missing:[names], reason} — reason vich sirf names, values kade nahi */
function status() {
  const mode = rawMode();
  const out = (m, missing, reason) => ({ mode: m, configured: !missing.length, missing, reason: reason || null });
  if (!mode) return isProd() ? out(null, ['EMAIL_MODE'], 'EMAIL_MODE is not set') : out('log', []);
  if (mode === 'log') {
    if (isProd() && process.env.ALLOW_OTP_LOG !== 'yes')
      return out(mode, ['ALLOW_OTP_LOG'], 'EMAIL_MODE=log is refused in production unless ALLOW_OTP_LOG=yes');
    return out(mode, []);
  }
  if (mode === 'smtp') {
    const { missing, heloName } = smtpConfig();
    return { ...out(mode, missing, missing.length ? `missing or invalid: ${missing.join(', ')}` : null), helo: heloName || null };
  }
  if (mode === 'ses') {
    if (!process.env.EMAIL_FROM) return out(mode, ['EMAIL_FROM'], 'EMAIL_FROM is not set');
    return out(mode, []);
  }
  return out(mode, ['EMAIL_MODE'], `EMAIL_MODE "${mode}" is unknown (use log, smtp or ses)`);
}

/* Error da ik safe hissa: nodemailer code (+ SMTP response code), nahi ta message —
   us vich koi email address / username / password na rahe */
function safeDetail(e) {
  if (e && e.code) return `${e.code}${e.responseCode ? ` ${e.responseCode}` : ''}`;
  let msg = String((e && (e.message || e.name)) || 'error');
  for (const k of ['SMTP_PASS', 'SMTP_USER']) {
    const v = process.env[k];
    if (v && v.length >= 3) msg = msg.split(v).join('<hidden>');
  }
  return msg.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '<address>').replace(/\s+/g, ' ').slice(0, 200);
}

/* ---------------- SES ---------------- */
let sesClient;
function ses() {
  if (!sesClient) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    sesClient = new SESv2Client({ region: process.env.AWS_REGION || 'ap-south-1' });
  }
  return sesClient;
}

async function sendSes({ to, subject, text, html }) {
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

/* ---------------- SMTP ---------------- */
/* Ik lazy pooled transport. Config badle (env call time te padhda) ta purana band, naya bane. */
let smtp = { key: null, transport: null };

function smtpTransport(cfg) {
  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass, cfg.heloName]))
    .digest('hex');
  if (smtp.transport && smtp.key === key) return smtp.transport;
  if (smtp.transport) smtp.transport.close();
  const nodemailer = require('nodemailer');
  smtp = {
    key,
    transport: nodemailer.createTransport({
      pool: true,
      maxConnections: 2,
      host: cfg.host,
      port: cfg.port,
      name: cfg.heloName, /* EHLO greeting */
      secure: cfg.secure, /* true = implicit TLS (465) */
      requireTLS: !cfg.secure, /* baaki sab: STARTTLS zaroori, plain-text te kade nahi bhejna */
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      logger: false,
      debug: false,
    }),
  };
  return smtp.transport;
}

async function sendSmtp({ to, subject, text, html }) {
  const cfg = smtpConfig();
  if (cfg.missing.length) throw new MailConfigError(`Email is not configured: missing or invalid ${cfg.missing.join(', ')}`);
  try {
    await smtpTransport(cfg).sendMail({
      from: cfg.from,
      to,
      ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
      subject,
      text,
      ...(html ? { html } : {}),
      envelope: { from: fromAddress(cfg.from), to: [to] },
    });
  } catch (e) {
    console.error(`[mail] send failed: ${safeDetail(e)}`);
    e.logged = true;
    throw e;
  }
}

/* mailtest / graceful shutdown: pool band karo taaki process exit ho sake */
function closeMail() {
  if (smtp.transport) smtp.transport.close();
  smtp = { key: null, transport: null };
}

/* ---------------- send ---------------- */
async function sendMail({ to, subject, text, html }) {
  const st = status();
  if (!st.configured) throw new MailConfigError(`Email is not configured: ${st.reason}`);

  if (st.mode === 'log') {
    console.log(`[DEV MAIL] to=${to} subject=${subject} text=${String(text).replace(/\s+/g, ' ').trim()}`);
    return;
  }
  if (st.mode === 'smtp') return sendSmtp({ to, subject, text, html });
  return sendSes({ to, subject, text, html });
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

module.exports = { sendMail, status, otpEmail, closeMail, safeDetail, fromAddress, MailConfigError };
