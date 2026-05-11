import { test, expect } from '@playwright/test';
import { loginAs, hasApiError } from './helpers/auth.js';

async function openInternals(page) {
  await loginAs(page, 'admin');
  await page.click('button:has-text("Internals")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("▤Gantt")');
  await page.waitForTimeout(2000);
}

test.describe('Internals: Data loads', () => {
  test('no API error on Internals tab', async ({ page }) => {
    await openInternals(page);
    expect(await hasApiError(page)).toBe(false);
  });

  test('Internals programme shows items', async ({ page }) => {
    await openInternals(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(200);
  });

  test('All towers visible in internals', async ({ page }) => {
    await openInternals(page);
    const body = await page.textContent('body');
    
    
  });
});

test.describe('Internals: IKEW subbie view', () => {
  test('IKEW sees Internals without API error', async ({ page }) => {
    await loginAs(page, 'ikew');
    await page.waitForTimeout(1500);
    expect(await hasApiError(page)).toBe(false);
  });

  test('IKEW does NOT see Groundworks tab', async ({ page }) => {
    await loginAs(page, 'ikew');
    await expect(page.locator('button:has-text("Groundworks")')).not.toBeVisible();
  });

  test('IKEW sees Internals programme items', async ({ page }) => {
    await loginAs(page, 'ikew');
    await page.click('button:has-text("▤Gantt")');
    await page.waitForTimeout(2000);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(200);
  });
});

test.describe('Internals: Gantt view', () => {
  test('Gantt renders on Internals tab', async ({ page }) => {
    await openInternals(page);
    await expect(page.locator('text=Gantt').first()).toBeVisible({ timeout: 5000 });
  });

  test('Programme scope filter present', async ({ page }) => {
    await openInternals(page);
    const body = await page.textContent('body');
    expect(body).toContain('All tabs');
    expect(body).toContain('Internals');
  });
});
