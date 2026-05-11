import { test } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

test('debug groundworks page', async ({ page }) => {
  await loginAs(page, 'admin');
  await page.click('button:has-text("Groundworks")');
  await page.waitForTimeout(2000);
  console.log('=== BODY TEXT ===');
  console.log(await page.textContent('body'));
  console.log('=== BUTTONS ===');
  const buttons = await page.locator('button').all();
  for (const btn of buttons) {
    console.log('BUTTON:', await btn.textContent());
  }
});

test('debug dbs page', async ({ page }) => {
  await loginAs(page, 'dbs');
  await page.waitForTimeout(2000);
  console.log('=== DBS BODY ===');
  console.log(await page.textContent('body'));
  console.log('=== DBS BUTTONS ===');
  const buttons = await page.locator('button').all();
  for (const btn of buttons) {
    console.log('BUTTON:', await btn.textContent());
  }
});
