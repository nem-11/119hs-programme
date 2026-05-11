import { test, expect, devices } from '@playwright/test';
import { loginAs, hasApiError } from './helpers/auth.js';

const MOBILE = devices['iPhone 14'];

test.use({ ...MOBILE });

test('Mobile: login page usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[placeholder="Username"]')).toBeVisible();
  await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
});

test('Mobile: nav tabs visible after login', async ({ page }) => {
  await loginAs(page, 'site');
  await expect(page.locator('button:has-text("Groundworks")')).toBeVisible({ timeout: 5000 });
});

test('Mobile: Internals loads without API error', async ({ page }) => {
  await loginAs(page, 'site');
  await page.click('button:has-text("Internals")');
  await page.waitForTimeout(2000);
  expect(await hasApiError(page)).toBe(false);
});

test('Mobile: Logout button reachable', async ({ page }) => {
  await loginAs(page, 'site');
  await expect(page.locator('button:has-text("Logout")')).toBeVisible();
});

test('Mobile: admin navigates all tabs', async ({ page }) => {
  await loginAs(page, 'admin');
  for (const tab of ['Groundworks', 'Internals', 'Project programme']) {
    const link = page.locator('button:has-text("' + tab + '")');
    if (await link.isVisible()) {
      await link.click();
      await page.waitForTimeout(1000);
      expect(await hasApiError(page)).toBe(false);
    }
  }
});
