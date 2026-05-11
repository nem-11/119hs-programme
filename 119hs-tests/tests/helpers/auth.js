export const USERS = {
  admin: { username: 'admin', password: '119hs', role: 'admin' },
  site:  { username: 'site',  password: 'site123', role: 'viewer' },
  dbs:   { username: 'DBs',   password: 'ground1', role: 'gw-subbie' },
  ikew:  { username: 'IKEW',  password: 'Ikew1',   role: 'int-subbie' },
  board: { username: 'board', password: 'board119', role: 'viewer' },
};

export const BASE_URL = process.env.BASE_URL || 'https://119hs.co.uk';

export async function loginAs(page, userKey) {
  const user = USERS[userKey];
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.fill('input[placeholder="Username"]', user.username);
  await page.fill('input[placeholder="Password"]', user.password);
  await page.click('button:has-text("Sign In")');
  await page.locator('button:has-text("Groundworks"), button:has-text("Internals")').first().waitFor({ timeout: 10000 });
  return user;
}

export async function hasApiError(page) {
  const text = await page.textContent('body');
  return text.includes('Cannot reach API') || text.includes('REACT_APP_API_URL');
}
