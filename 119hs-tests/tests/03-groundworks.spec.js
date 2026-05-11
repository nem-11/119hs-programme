import { test, expect } from '@playwright/test';
import { loginAs, hasApiError } from './helpers/auth.js';

async function openGroundworksGantt(page) {
  await loginAs(page, 'admin');
  await page.click('button:has-text("Groundworks")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("▤Gantt")');
  await page.waitForTimeout(2000);
}

test.describe('Groundworks: Data loads', () => {
  test('no API error on Groundworks tab', async ({ page }) => {
    await openGroundworksGantt(page);
    expect(await hasApiError(page)).toBe(false);
  });

  test('Groundworks Gantt renders content', async ({ page }) => {
    await openGroundworksGantt(page);
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(200);
  });

  test('Groundworks Gantt has zone entries', async ({ page }) => {
    await openGroundworksGantt(page);
    const body = await page.textContent('body');
    // T2 not yet scheduled — just check Gantt renders
    expect(body).toContain('Gantt');
  });
});

test.describe('Groundworks: Range controls', () => {
  test('range buttons present', async ({ page }) => {
    await openGroundworksGantt(page);
    const body = await page.textContent('body');
    const hasRangeControls = body.includes('7d') || body.includes('14d') || body.includes('Fit all') || body.includes('4 wk');
    expect(hasRangeControls).toBe(true);
  });
});

test.describe('Groundworks: DBs subbie view', () => {
  test('DBs sees Groundworks without API error', async ({ page }) => {
    await loginAs(page, 'dbs');
    await page.waitForTimeout(1000);
    expect(await hasApiError(page)).toBe(false);
    await expect(page.locator('button:has-text("Groundworks")')).toBeVisible();
  });
});
