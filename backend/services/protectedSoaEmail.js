import nodemailer from 'nodemailer';

export function protectedSmtpOptions(env = process.env) {
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
    if (!String(env[name] || '').trim()) throw new Error('PROTECTED_EMAIL_CONFIGURATION');
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PROTECTED_EMAIL_CONFIGURATION');
  const secure = String(env.SMTP_SECURE).toLowerCase() === 'true';
  return {
    host: env.SMTP_HOST.trim(), port, secure, requireTLS: !secure,
    auth: { user: env.SMTP_USER.trim(), pass: env.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    logger: false, debug: false,
  };
}

export function createProtectedSoaMailer({ environment = process.env, createTransport = nodemailer.createTransport } = {}) {
  return {
    async verify() {
      const transport = createTransport(protectedSmtpOptions(environment));
      try { await transport.verify(); } finally { transport.close(); }
    },
    async send({ email, reference, password, unitNumber, periodStart, periodEnd }) {
      const transport = createTransport(protectedSmtpOptions(environment));
      try {
        const result = await transport.sendMail({
          from: environment.SMTP_FROM.trim(), to: { address: email },
          subject: `Your protected SOA password · ${reference}`,
          text: [
            `Protected statement of account: ${reference}`,
            `File: SOA-${reference}.pdf`, `Unit: ${unitNumber}`,
            `Billing coverage: ${periodStart} to ${periodEnd}`, '',
            `Opening password: ${password}`, '',
            'Download the matching PDF from your signed-in resident portal.',
            'Keep this password private. It continues to open this downloaded file.',
            'If you lose this email, create a new protected download in the portal.',
          ].join('\n'),
          disableFileAccess: true, disableUrlAccess: true,
        });
        const accepted = (result.accepted || []).map(value => String(value.address || value).toLowerCase());
        if (!accepted.includes(email.toLowerCase()) || result.rejected?.length || result.pending?.length) throw new Error('EMAIL_NOT_ACCEPTED');
      } catch {
        // SMTP errors may contain the envelope or message. Never propagate them.
        throw new Error('PASSWORD_EMAIL_FAILED');
      } finally { transport.close(); }
    },
  };
}
