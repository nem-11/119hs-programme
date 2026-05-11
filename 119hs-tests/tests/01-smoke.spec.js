// tests/01-smoke.spec.js
// Quick health checks — run these first every time
import { test, expect } from '@playwright/test';
import { loginAs, hasApiError, USERS } from './helpers/auth.js';

test.describe('Smoke: API reachability', () => {
  test('API is up and responding', async ({ page }) => {
    const apiUrl = process.env.API_URL || 'https://one19hs-api.onrender.com';
    const response = await page.request.get(`${apiUrl}/health`).catch(() => null);
    // Accept 200 or 404 (404 means server is up, just no /health route)
    if (response) {
      expect([200, 404, 401]).toContain(response.status());
    } else {
      throw new Error(`API at ${apiUrl} is completely unreachable`);
    }
  });

  test('Frontend loads without blank screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).not.toBeEmpty();
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(10);
  });
});

test.describe('Smoke: Login — all roles', () => {
  for (const [key, user] of Object.entries(USERS)) {
    test(`${key} (${user.username}) can log in`, async ({ page }) => {
      await loginAs(page, key);
      // Should NOT see login form any more
      const loginForm = page.locator('input[type="password"]');
      await expect(loginForm).not.toBeVisible();
      // Should NOT see API error immediately on login
      const apiErr = await hasApiError(page);
      expect(apiErr, `API error shown to ${key} after login`).toBe(false);
    });
  }
});

test.describe('Smoke: Logout works', () => {
  test('admin can log out and is returned to login', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.click('button:has-text("Logout"), a:has-text("Logout")');
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5000 });
  });
});
