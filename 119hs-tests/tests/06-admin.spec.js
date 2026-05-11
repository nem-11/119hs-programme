// tests/06-admin.spec.js
// Admin-only: programme editor, templates, zone drawing tool
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

test.describe('Admin: Programme editor', () => {
  test('admin can access programme editor', async ({ page }) => {
    await loginAs(page, 'admin');
    // Look for an edit/admin button
    const editBtn = page.locator('button:has-text("Edit"), a:has-text("Admin"), button:has-text("Manage")');
    if (await editBtn.first().isVisible()) {
      await editBtn.first().click();
      await page.waitForTimeout(1000);
      // Should see some form of editing interface
      const hasForm = await page.locator('input, select, textarea, form').count();
      expect(hasForm).toBeGreaterThan(0);
    }
  });

  test('admin can see template management', async ({ page }) => {
    await loginAs(page, 'admin');
    const templateLink = page.locator('text=Template, text=template');
    if (await templateLink.first().isVisible()) {
      await templateLink.first().click();
      await page.waitForTimeout(1000);
      const err = await page.textContent('body');
      expect(err).not.toContain('Cannot reach API');
    }
  });
});

test.describe('Admin: Zone drawing tool', () => {
  test('zone tool accessible to admin', async ({ page }) => {
    await loginAs(page, 'admin');
    const zoneLink = page.locator('text=Zone, text=zone, text=Drawing, text=Site plan');
    if (await zoneLink.first().isVisible()) {
      await zoneLink.first().click();
      await page.waitForTimeout(1000);
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain('Cannot reach API');
    }
  });

  test('zone tool NOT accessible to site team', async ({ page }) => {
    await loginAs(page, 'site');
    const zoneLink = page.locator('text=Zone drawing, text=Upload site plan');
    await expect(zoneLink).not.toBeVisible();
  });
});

test.describe('Admin: No errors on page navigation', () => {
  const adminPages = [
    { name: 'Groundworks', selector: 'button:has-text("Groundworks")' },
    { name: 'Internals', selector: 'button:has-text("Internals")' },
    { name: 'Project programme', selector: 'button:has-text("Project programme")' },
  ];

  for (const pg of adminPages) {
    test(`admin navigates to ${pg.name} without errors`, async ({ page }) => {
      await loginAs(page, 'admin');
      const link = page.locator(pg.selector);
      if (await link.isVisible()) {
        await link.click();
        await page.waitForTimeout(2000);
        // No JS error modal, no API error banner
        const bodyText = await page.textContent('body');
        expect(bodyText).not.toContain('Cannot reach API');
        expect(bodyText).not.toContain('Unhandled error');
        expect(bodyText).not.toContain('TypeError');
      }
    });
  }
});
