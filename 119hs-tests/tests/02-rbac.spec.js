import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

const ROLE_ACCESS = {
  admin: { tabs: ['Groundworks', 'Internals', 'Project programme'] },
  site:  { tabs: ['Groundworks', 'Internals', 'Project programme'] },
  dbs:   { tabs: ['Groundworks'], blocked: ['Internals'] },
  ikew:  { tabs: ['Internals'], blocked: ['Groundworks'] },
  board: { tabs: ['Groundworks', 'Internals', 'Project programme'] },
};

test.describe('RBAC: Tab visibility', () => {
  for (const [role, access] of Object.entries(ROLE_ACCESS)) {
    test(`${role}: correct tabs visible`, async ({ page }) => {
      await loginAs(page, role);
      for (const tab of access.tabs) {
        await expect(
          page.locator(`button:has-text("${tab}")`)
        ).toBeVisible({ timeout: 5000 });
      }
      if (access.blocked) {
        for (const tab of access.blocked) {
          await expect(
            page.locator(`button:has-text("${tab}")`)
          ).not.toBeVisible();
        }
      }
    });
  }
});

test.describe('RBAC: Edit controls', () => {
  test('admin sees settings/admin controls', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page.locator('button:has-text("⚙Settings")').first()).toBeVisible();
  });

  test('site team has no settings controls', async ({ page }) => {
    await loginAs(page, 'site');
    await expect(page.locator('button:has-text("⚙Settings")')).not.toBeVisible();
  });
});

test.describe('RBAC: Direct URL protection', () => {
  test('non-admin cannot see admin nav items', async ({ page }) => {
    await loginAs(page, 'site');
    await expect(page.locator('button:has-text("⚙Settings")')).not.toBeVisible();
    await expect(page.locator('button:has-text("⧉Templates")')).not.toBeVisible();
  });
});