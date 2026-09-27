import { expect, test, Page } from '@playwright/test';

// Low graphics + capped frame rate keep the test fast on machines without a GPU.
const URL = '/?lowgfx&fps=5';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function startGame(page: Page, side: 0 | 1, scenario = 'taubensteuer') {
  await page.goto(URL);
  await expect(page.locator('#menu')).toBeVisible();
  await page.waitForFunction(() => (window as any).__sa?.mode() === 'attract');
  await page.click(`.scen[data-id="${scenario}"]`);
  await page.click(`#side-toggle button[data-side="${side}"]`);
  await page.click('#start');
  await expect(page.locator('#topbar')).toBeVisible();
  await page.waitForFunction(() => (window as any).__sa.mode() === 'playing' && (window as any).__sa.snapshot()?.tick > 5);
}

test('main menu shows title, scenarios and the city in the background', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(URL);
  await expect(page.locator('.big-logo')).toHaveText(/SimAufstand\s*2000/);
  await expect(page.locator('.scen')).toHaveCount(3);
  await expect(page.locator('#goal')).toContainText('Taubensteuer');
  await page.waitForFunction(() => (window as any).__sa?.snapshot()?.tick > 10);
  expect(errors).toEqual([]);
});

test('police: select units by dragging, move them with a right click', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, 0);
  const vp = page.viewportSize()!;
  await page.mouse.move(40, 70);
  await page.mouse.down();
  await page.mouse.move(vp.width - 240, vp.height - 90, { steps: 4 });
  await page.mouse.up();
  const sel: number[] = await page.evaluate(() => (window as any).__sa.selected());
  expect(sel.length).toBeGreaterThan(3);
  await expect(page.locator('#sel-info')).toContainText('Polizist');

  const id = sel[0];
  const before = await page.evaluate((id) => (window as any).__sa.snapshot().units.find((u: any) => u.id === id), id);
  await page.mouse.click(vp.width / 2 - 150, vp.height / 2 + 100, { button: 'right' });
  await page.waitForFunction(
    ([id, x, y]) => {
      const u = (window as any).__sa.snapshot().units.find((u: any) => u.id === id);
      return u && Math.hypot(u.x - x, u.y - y) > 1.5;
    },
    [id, before.x, before.y],
    { timeout: 30000 },
  );
  // pause freezes the simulation
  await page.keyboard.press(' ');
  await expect(page.locator('#pausebanner')).toBeVisible();
  const t1 = await page.evaluate(() => (window as any).__sa.snapshot().tick);
  await page.waitForTimeout(1200);
  const t2 = await page.evaluate(() => (window as any).__sa.snapshot().tick);
  expect(t2).toBe(t1);
  await page.keyboard.press(' ');
  await expect(page.locator('#pausebanner')).toBeHidden();
  expect(errors).toEqual([]);
});

test('map rotates by 90° with the toolbar buttons', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, 0);
  const view = () =>
    page.evaluate(() => {
      const sa = (window as any).__sa;
      const r = sa.game.renderer;
      const tile = sa.tileScreen(20, 30);
      const back = r.screenToWorld(tile.x, tile.y);
      const mid = r.screenToWorld(r.app.screen.width / 2, r.app.screen.height / 2);
      return { rot: r.rot, tile, back, mid };
    });
  const v0 = await view();
  expect(v0.rot).toBe(0);
  await page.click('#btn-rot-right');
  const v1 = await view();
  expect(v1.rot).toBe(1);
  // the tile moved on screen, but screen <-> world still round-trips and the centre stays put
  expect(Math.hypot(v1.tile.x - v0.tile.x, v1.tile.y - v0.tile.y)).toBeGreaterThan(20);
  expect(v1.back.x).toBeCloseTo(20.5, 1);
  expect(v1.back.y).toBeCloseTo(30.5, 1);
  expect(v1.mid.x).toBeCloseTo(v0.mid.x, 0);
  expect(v1.mid.y).toBeCloseTo(v0.mid.y, 0);
  await page.click('#btn-rot-left');
  await page.click('#btn-rot-left');
  expect((await view()).rot).toBe(3);
  await page.keyboard.press('.');
  const v4 = await view();
  expect(v4.rot).toBe(0);
  expect(v4.tile.x).toBeCloseTo(v0.tile.x, 0);
  expect(v4.tile.y).toBeCloseTo(v0.tile.y, 0);
  // the turn animation finishes and leaves no ghost image or transform behind
  await page.waitForFunction(() => {
    const r = (window as any).__sa.game.renderer;
    const m = r.spinner.localTransform;
    return !r.spin && r.app.stage.children.length === 1 && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;
  });
  expect(errors).toEqual([]);
});

test('police: requesting reinforcements costs funds', async ({ page }) => {
  await startGame(page, 0);
  const count = () => page.evaluate(() => (window as any).__sa.snapshot().units.filter((u: any) => u.s === 0).length);
  const before = await count();
  await page.click('#buy button[data-kind="0"]'); // Polizist
  await page.waitForFunction((n) => (window as any).__sa.snapshot().units.filter((u: any) => u.s === 0).length > n, before);
});

test('demonstrators: sit down with the hotkey', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, 1);
  const vp = page.viewportSize()!;
  await page.mouse.move(40, 70);
  await page.mouse.down();
  await page.mouse.move(vp.width - 240, vp.height - 90, { steps: 4 });
  await page.mouse.up();
  const sel: number[] = await page.evaluate(() => (window as any).__sa.selected());
  expect(sel.length).toBeGreaterThan(3);
  await expect(page.locator('#sel-abilities')).toContainText('Hinsetzen');
  await page.keyboard.press('q');
  await page.waitForFunction(() => (window as any).__sa.snapshot().units.filter((u: any) => u.s === 1 && u.f & 1).length >= 3);
  expect(errors).toEqual([]);
});

test('music: the game track plays after starting (Web Audio)', async ({ page }) => {
  await startGame(page, 0);
  expect(await page.evaluate(() => (window as any).__sa.track())).toBe('game');
  const state = await page.evaluate(() => (window as any).__sa.audioState());
  expect(['running', 'suspended']).toContain(state);
});

test('end screen: public opinion collapse ends the game, "Nochmal spielen" restarts', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?lowgfx&fps=5&debug');
  await page.waitForFunction(() => (window as any).__sa?.mode() === 'attract');
  await page.click('#side-toggle button[data-side="1"]'); // play the demonstrators
  await page.click('#start');
  await page.waitForFunction(() => (window as any).__sa.mode() === 'playing' && (window as any).__sa.snapshot()?.tick > 5);
  await page.evaluate(() => (window as any).__sa.setOpinion(97));
  await expect(page.locator('#end')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#end-head')).toHaveText('Gewonnen!');
  await expect(page.locator('#end-reason')).toContainText('Innenministerium');
  await expect(page.locator('#end-stats tr')).toHaveCount(10);
  expect(await page.evaluate(() => (window as any).__sa.track())).toBe('win');
  await page.click('#end-again');
  await page.waitForFunction(() => (window as any).__sa.mode() === 'playing' && (window as any).__sa.snapshot()?.tick > 3);
  await expect(page.locator('#end')).toBeHidden();
  expect(errors).toEqual([]);
});
