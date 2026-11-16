import { test } from '@playwright/test';

// Design-review helper: SCREENS=1 SCREENS_DIR=<folder> npx playwright test e2e/_screens.spec.ts
const out = process.env.SCREENS_DIR ?? 'test-results/screens';
const pages: [string, string][] = [
  ['sessions', '/sessions'], ['results', '/results'], ['report', '/results/ses-084'], ['compare', '/compare'],
  ['publishing', '/publishing?source=ses-084'], ['devices', '/devices'], ['settings', '/settings'], ['tablet', '/results/ses-084-tablet'], ['gaps', '/results/ses-084-gaps'],
];
for (const [name, path] of pages) {
  test(name, async ({ page }) => {
    await page.goto('/#' + path);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  });
}
test('live', async ({ page }) => {
  await page.goto('/#/sessions');
  await page.getByRole('button', { name: 'Start demo session' }).click();
  await page.waitForURL(/#\/live/);
  await page.getByRole('button', { name: '60×' }).click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}/live.png`, fullPage: true });
});
test('mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/results/ses-084');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: false });
});
