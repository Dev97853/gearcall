// lib/email.js
// Tiny wrapper around the Resend API (https://resend.com) using Node's
// built-in fetch — no external dependency needed.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Resend's free/test sender. Replace with an address on your own verified
// domain (e.g. no-reply@gearcall.com) once you add a domain in Resend.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'GearCall <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY is not set — skipping real send. Email would have been:');
    console.warn(`  To: ${to}\n  Subject: ${subject}\n  ${html}`);
    return { skipped: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[email] Resend API error:', res.status, data);
    throw new Error(data.message || 'Failed to send email');
  }
  return data;
}

function forgotPasswordEmail({ to, name, resetUrl }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#181c22;">Reset your GearCall password</h2>
      <p>Hi ${name || 'there'},</p>
      <p>We received a request to reset your GearCall account password. Click the button below to choose a new one. This link expires in 30 minutes.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}" style="background:#f2b705;color:#181c22;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Reset Password</a>
      </p>
      <p style="color:#666;font-size:13px;">If you didn't request this, you can safely ignore this email — your password will not change.</p>
      <p style="color:#999;font-size:12px;">Or paste this link into your browser:<br>${resetUrl}</p>
    </div>
  `;
  return sendEmail({ to, subject: 'Reset your GearCall password', html });
}

module.exports = { sendEmail, forgotPasswordEmail };
