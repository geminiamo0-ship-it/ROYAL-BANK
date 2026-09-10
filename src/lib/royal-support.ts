export function getRoyalSupportTelegramUrl(): string | null {
  const directUrl = process.env.ROYAL_SUPPORT_TELEGRAM_URL?.trim();
  if (directUrl) {
    try {
      const url = new URL(directUrl);
      if (url.protocol === 'https:' && ['t.me', 'telegram.me'].includes(url.hostname)) {
        return url.toString();
      }
    } catch {
      // Fall through to the username form.
    }
  }

  const username = process.env.ROYAL_SUPPORT_TELEGRAM_USERNAME?.trim().replace(/^@/, '');
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `https://t.me/${username}`;
  }

  return null;
}
