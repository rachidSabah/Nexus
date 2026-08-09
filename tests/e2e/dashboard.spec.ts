// Playwright E2E tests for Agent Nexus OS Dashboard
// Run: npx playwright test
//
// Requires:
//   1. Gateway running at http://localhost:8787
//   2. Dashboard running at http://localhost:3000

import { test, expect } from '@playwright/test';

const DASHBOARD = process.env.DASHBOARD_URL || 'http://localhost:3000';

test.describe('Dashboard — Phase 4 pages', () => {
  test('overview page loads with metrics', async ({ page }) => {
    await page.goto(DASHBOARD);
    await expect(page.locator('h1')).toContainText('Overview');
    await expect(page.locator('text=Active Providers')).toBeVisible();
    await expect(page.locator('text=Uptime')).toBeVisible();
  });

  test('agents page loads', async ({ page }) => {
    await page.goto(`${DASHBOARD}/agents`);
    await expect(page.locator('h1')).toContainText('Agents');
    await expect(page.locator('text=Agent Registry')).toBeVisible();
  });

  test('workflows page loads', async ({ page }) => {
    await page.goto(`${DASHBOARD}/workflows`);
    await expect(page.locator('h1')).toContainText('Workflows');
    await expect(page.locator('text=Definitions')).toBeVisible();
  });

  test('teams page loads', async ({ page }) => {
    await page.goto(`${DASHBOARD}/teams`);
    await expect(page.locator('h1')).toContainText('Teams');
  });

  test('memory page loads', async ({ page }) => {
    await page.goto(`${DASHBOARD}/memory`);
    await expect(page.locator('h1')).toContainText('Memory');
    await expect(page.locator('text=namespaces')).toBeVisible();
  });

  test('marketplace page loads', async ({ page }) => {
    await page.goto(`${DASHBOARD}/marketplace`);
    await expect(page.locator('h1')).toContainText('Marketplace');
    // The marketplace page has a filter dropdown and extension cards
    await expect(page.locator('select')).toBeVisible();
  });
});

test.describe('Gateway — Phase 4 API endpoints', () => {
  const API = process.env.GATEWAY_URL || 'http://localhost:8787';

  test('GET /v1/agents returns list', async ({ request }) => {
    const r = await request.get(`${API}/v1/agents`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });

  test('GET /v1/agents/stats returns counts', async ({ request }) => {
    const r = await request.get(`${API}/v1/agents/stats`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.online).toBeGreaterThanOrEqual(0);
  });

  test('GET /v1/workflows returns built-in templates', async ({ request }) => {
    const r = await request.get(`${API}/v1/workflows`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.length).toBeGreaterThanOrEqual(3); // 3 built-in templates
  });

  test('POST /v1/plan returns execution plan', async ({ request }) => {
    const r = await request.post(`${API}/v1/plan`, {
      data: { request: 'Build a SaaS application' },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.steps.length).toBe(5); // architecture → backend → frontend → testing → documentation
  });

  test('GET /v1/tools returns built-in tools', async ({ request }) => {
    const r = await request.get(`${API}/v1/tools`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.length).toBeGreaterThanOrEqual(10); // filesystem, terminal, git, browser, database, http, mcp
  });

  test('POST /v1/memory/:namespace/store and search', async ({ request }) => {
    // Store
    const storeRes = await request.post(`${API}/v1/memory/test-ns/store`, {
      data: { data: 'Hello world', scope: 'short', contentType: 'text' },
    });
    expect(storeRes.ok()).toBeTruthy();

    // Search
    const searchRes = await request.post(`${API}/v1/memory/test-ns/search`, {
      data: { query: 'Hello', scope: 'short' },
    });
    expect(searchRes.ok()).toBeTruthy();
    const body = await searchRes.json();
    expect(body.results.length).toBeGreaterThan(0);
  });
});
