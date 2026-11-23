const { test, expect } = require('@playwright/test');

test('map failure exposes a working offline fallback', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/liberty', route => route.abort());
  await page.goto('/');
  await page.getByLabel('Bootstrap token').fill(process.env.SITREP_TEST_SETUP_TOKEN);
  await page.getByLabel('Username').fill('test-before-bootstrap');
  await page.getByLabel('Password').fill('synthetic-test-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Use offline map' }).click();
  const map = page.getByRole('region', { name: 'Location selection map' });
  await expect(map.getByText('Natural Earth')).toBeVisible();
  await expect(map).toHaveAttribute('data-map-ready', 'true');
  await map.locator('canvas').click({ position: { x: 250, y: 140 } });
  await expect(map.getByLabel('Monitoring pin')).toBeVisible();
});

test('bootstrap, sign in, change mode and open kiosk', async ({ page }) => {
  test.setTimeout(150000);
  const tile = page.waitForResponse(response =>
    response.url().includes('tiles.openfreemap.org') && /\.(pbf|mvt)(?:\?|$)/.test(response.url()) &&
    response.ok(), { timeout: 35000 });
  tile.catch(() => {});
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/?kiosk=1');
  await expect(page.getByRole('heading', { name: 'Create administrator' })).toBeVisible();
  await page.getByLabel('Bootstrap token').fill(process.env.SITREP_TEST_SETUP_TOKEN);
  await page.getByLabel('Username').fill('playwright-admin');
  await page.getByLabel('Password').fill('temporary-test-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  const picker = page.getByRole('region', { name: 'Location selection map' });
  await expect(picker.locator('canvas')).toBeVisible();
  await expect(picker.getByText(/OpenStreetMap/)).toBeVisible({ timeout: 25000 });
  await tile;
  await expect(picker).toHaveAttribute('data-map-ready', 'true', { timeout: 30000 });
  if (process.env.SITREP_SCREENSHOTS) await page.screenshot({ path: process.env.SITREP_SCREENSHOTS + '/setup-map.png' });
  await picker.locator('canvas').click({ position: { x: 250, y: 220 } });
  const pin = picker.getByLabel('Monitoring pin');
  await expect(pin).toBeVisible();
  const before = await page.locator('.coordinate-readout').textContent();
  await expect(picker).toHaveAttribute('data-map-ready', 'true');
  await pin.hover();
  const marker = await pin.boundingBox();
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2 + 35, marker.y + marker.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.coordinate-readout')).not.toHaveText(before);
  await page.getByText('Manual coordinates', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('47.2');
  await page.getByLabel('Longitude', { exact: true }).fill('-123.2');
  await page.getByRole('button', { name: 'Use coordinates' }).click();
  await expect(page.locator('.lookup-status')).toContainText('Address lookup is not configured');
  await page.getByLabel('Radius preset').selectOption('100');
  await expect(page.getByLabel('Radius (km)')).toHaveValue('100');
  await page.getByText('Place details and preferences', { exact: true }).click();
  await expect(page.getByLabel(/Time zone/)).toHaveValue('America/Los_Angeles');
  await page.getByLabel('Area name').fill('Test area');
  await page.getByRole('button', { name: 'Confirm monitoring location' }).click();
  await expect(page.getByRole('heading', { name: 'Operational map' })).toBeVisible();
  const operationsMap = page.getByRole('region', { name: 'Operational map' });
  await expect(operationsMap.getByText(/OpenStreetMap/)).toBeVisible({ timeout: 25000 });
  await expect(operationsMap).toHaveAttribute('data-map-ready', 'true', { timeout: 30000 });
  const layout = await page.locator('.terrain').boundingBox();
  expect(layout.width).toBeGreaterThan(1920 * 0.9);
  expect(layout.height).toBeGreaterThan(1080 * 0.85);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1080);
  const stored = (await (await page.request.get('/api/v1/locations')).json())[0];
  expect(stored).toMatchObject({ latitude: 47.2, longitude: -123.2, radius: 100, is_primary: true });
  if (process.env.SITREP_SCREENSHOTS) await page.screenshot({ path: process.env.SITREP_SCREENSHOTS + '/map-first-1080.png' });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Monitoring area' })).toHaveValue(String(stored.id));
  await expect(page.getByRole('button', { name: 'Exit kiosk' })).toBeVisible();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByText('needs key')).toBeVisible();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Open maritime mode' }).click();
  const ships = page.getByRole('region', { name: 'Vessel list' });
  await expect(ships.getByRole('button', { name: /AIS TEST VESSEL/ })).toBeVisible();
  await ships.getByRole('button', { name: /AIS TEST VESSEL/ }).click();
  await expect(page.getByRole('region', { name: 'Vessel details' }).getByText('123456789')).toBeVisible();
  await page.getByRole('button', { name: 'Close vessel' }).click();
  await page.getByLabel('Name or MMSI').fill('nonsense');
  await expect(ships.getByText('No vessels match the filters.')).toBeVisible();
  await page.getByLabel('Operational view').selectOption('normal');
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const observed = Date.now() / 1000;
  await page.route('**/api/v1/aviation/aircraft', route => route.fulfill({ json: {
    settings: { enabled: true, radius: 200, primary_provider: 'adsb.lol', fallback: true },
    scope: { id: stored.id, latitude: 47.2, longitude: -123.2, radius: 200 },
    providers: [{ provider: 'adsb.lol', state: 'online', interval: 200, succeeded: new Date().toISOString(),
      attempted: null, retry_at: null, remaining: null, requests_today: 1, request_budget: 450 }],
    aircraft: [{ id: 'a123b4', latitude: 47.22, longitude: -123.26, callsign: 'E2EFLIGHT',
      altitude: 3000, speed: 100, heading: 270, vertical_rate: 0, ground: false, category: 'A1',
      squawk: null, contact: observed, source: 'adsb_icao', accuracy: null,
      observed, received: observed, age: 0, freshness: 'fresh' }],
  } }));
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Open aviation mode' }).click();
  await expect(page.getByLabel('Aircraft list')).toBeVisible();
  await expect(page.getByText('200 km aviation radius')).toBeVisible();
  await page.getByRole('button', { name: /E2EFLIGHT/ }).click();
  await expect(page.getByLabel('Aircraft details').getByText('270 °')).toBeVisible();
  await page.getByRole('button', { name: 'Close aircraft' }).click();
  await page.getByLabel('Callsign or ICAO').fill('absent');
  await expect(page.getByText('No aircraft match the filters.')).toBeVisible();
  await page.getByLabel('Operational view').selectOption('normal');
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const quakes = page.getByRole('checkbox', { name: /Earthquakes/ });
  await quakes.uncheck();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: /^Incidents ·/ }).click();
  await expect(page.getByRole('button', { name: /SIMULATED TEST EVENT \(near\)/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await quakes.check();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('button', { name: /SIMULATED TEST WEATHER/ })).toHaveCount(0);
  const nearEvent = page.getByRole('button', { name: /SIMULATED TEST EVENT \(near\)/ });
  await expect(nearEvent).toHaveCount(1);
  await expect(page.getByText('SIMULATED TEST EVENT (far)')).toHaveCount(0);
  await nearEvent.click();
  await expect(page.getByRole('link', { name: 'Source · test-fixture' })).toHaveAttribute('href', 'https://example.org/');
  await expect(page.getByRole('heading', { name: 'Related events' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SIMULATED TEST WEATHER' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SIMULATED TEST EVENT (far)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Acknowledge alert' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Minimum alert priority').selectOption('3');
  await page.getByRole('button', { name: 'Save alert rule' }).click();
  await expect(page.getByText('Alert rule saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acknowledge alert' })).toHaveCount(0);
  await page.getByLabel('Minimum alert priority').selectOption('2');
  await page.getByRole('button', { name: 'Save alert rule' }).click();
  await expect(page.getByRole('button', { name: 'Acknowledge alert' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Acknowledge alert' }).click();
  await expect(page.getByText(/Acknowledged ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('section.settings');
  await expect(settings.getByText(/SIMULATED TEST EVENT \(near\)/)).toBeVisible();
  await page.getByLabel('Area to manage').selectOption({ label: 'Test area' });
  await expect(page.getByLabel('Area name')).toHaveValue('Test area');
  await page.getByLabel('Area name').fill('Updated test area');
  await page.getByRole('button', { name: 'Save monitoring area' }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Updated test area' })).toBeAttached();
  const locationOrigin = { Origin: new URL(page.url()).origin };
  const createdArea = await page.request.post('/api/v1/locations', {
    headers: locationOrigin, data: { ...stored, name: 'Second test area' },
  });
  expect(createdArea.status()).toBe(201);
  const { id: secondId } = await createdArea.json();
  expect((await page.request.post('/api/v1/locations/' + secondId + '/primary', { headers: locationOrigin })).ok()).toBe(true);
  expect((await (await page.request.get('/api/v1/locations')).json())[0]).toMatchObject({ id: secondId, is_primary: true });
  expect((await page.request.delete('/api/v1/locations/' + secondId, { headers: locationOrigin })).ok()).toBe(true);
  expect((await (await page.request.get('/api/v1/locations')).json())[0]).toMatchObject({ id: stored.id, is_primary: true });
  const camera = await page.request.post('/api/v1/map-assets', {
    headers: locationOrigin, data: { kind: 'camera', name: 'Test publisher camera', attribution: 'Test publisher',
      latitude: stored.latitude, longitude: stored.longitude, source_url: 'https://example.org/camera' },
  });
  expect(camera.status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Return to area' }).click();
  await expect(operationsMap).toHaveAttribute('data-map-ready', 'true', { timeout: 30000 });
  await operationsMap.locator('canvas').click();
  await expect(page.getByRole('link', { name: 'Open original source' })).toHaveAttribute('href', 'https://example.org/camera');
  await page.getByRole('button', { name: 'Close detail' }).click();
  const { id: assetId } = await camera.json();
  const bridge = await page.request.post('/api/v1/map-assets/' + assetId, {
    headers: locationOrigin, data: { kind: 'bridge', name: 'Test operator bridge', attribution: 'Test operator',
      latitude: stored.latitude, longitude: stored.longitude, source_url: 'https://example.org/bridge',
      notice: { direction: 'northbound', status: 'closed', source_url: 'https://example.org/notice',
        expires_at: new Date(Date.now() + 3600000).toISOString() } },
  });
  expect(bridge.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Return to area' }).click();
  await expect(operationsMap).toHaveAttribute('data-map-ready', 'true', { timeout: 30000 });
  await operationsMap.locator('canvas').click();
  await expect(page.getByText('Northbound · closed')).toBeVisible();
  await expect(page.getByText('Southbound · Unknown')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Official notice' })).toHaveAttribute('href', 'https://example.org/notice');
  await page.getByRole('button', { name: 'Close detail' }).click();
  await page.getByRole('button', { name: /^Incidents ·/ }).click();
  await page.getByLabel('Operational view').selectOption('global');
  await expect(page.getByLabel('Operational view')).toHaveValue('global');
  await expect(page.getByText('SIMULATED TEST EVENT (far)')).toHaveCount(1);
  await page.getByLabel('Operational view').selectOption('weather');
  await expect(page.getByRole('button', { name: /SIMULATED TEST WEATHER/ })).toBeVisible();
  await expect(nearEvent).toHaveCount(0);
  await page.getByLabel('Operational view').selectOption('emergency');
  await expect(page.getByRole('button', { name: /SIMULATED TEST WILDFIRE/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /SIMULATED TEST WEATHER/ })).toHaveCount(0);
  await page.getByLabel('Operational view').selectOption('news');
  await expect(page.getByRole('button', { name: /SIMULATED TEST HEADLINE/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /SIMULATED TEST WILDFIRE/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close feed' }).click();
  await page.getByLabel('Operational view').selectOption('normal');
  await page.setViewportSize({ width: 2560, height: 1440 });
  const wide = await page.locator('.terrain').boundingBox();
  expect(wide.height).toBeGreaterThan(1440 * 0.85);
  await page.getByRole('button', { name: 'Return to area' }).click();
  await expect(operationsMap).toHaveAttribute('data-map-ready', 'true', { timeout: 30000 });
  if (process.env.SITREP_SCREENSHOTS) await page.screenshot({ path: process.env.SITREP_SCREENSHOTS + '/map-first-1440.png' });
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  if (process.env.SITREP_SCREENSHOTS) await page.screenshot({ path: process.env.SITREP_SCREENSHOTS + '/map-first-tablet.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Operational map' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow-x', 'visible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  if (process.env.SITREP_SCREENSHOTS) await page.screenshot({ path: process.env.SITREP_SCREENSHOTS + '/map-first-phone.png', fullPage: true });
  const headers = { Origin: new URL(page.url()).origin };
  const viewer = { username: 'test-viewer', password: 'synthetic-viewer-password' };
  const created = await page.request.post('/api/v1/accounts', { data: viewer, headers });
  expect(created.status()).toBe(201);
  const signedIn = await page.request.post('/api/v1/login', { data: viewer, headers });
  expect(signedIn.status()).toBe(200);
  const locations = await page.request.get('/api/v1/locations');
  const [location] = await locations.json();
  const update = await page.request.post('/api/v1/locations/' + location.id, { data: location, headers });
  expect(update.status()).toBe(403);
  const rule = await page.request.post('/api/v1/alert-rules', {
    data: { category: 'earthquake', minimum_severity: 4 }, headers,
  });
  expect(rule.status()).toBe(403);
  const history = await page.request.get('/api/v1/alerts/history');
  expect(await history.json()).toEqual([]);
});
