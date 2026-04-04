import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', request => {
    if (request.url().includes('api/v1/sales-channels/web/configuration')) {
      console.log('--- REQ HEADERS ---');
      console.log(request.headers());
    }
  });

  page.on('response', async (response) => {
    if (response.url().includes('api/v1/sales-channels')) {
      console.log('--- RES STATUS ---', response.status());
      if (response.status() === 200) {
          try {
              const body = await response.json();
              console.log('Got body for', response.url(), Object.keys(body).slice(0,5));
          } catch(e) {}
      }
    }
  });

  console.log('Navigating...');
  try {
    await page.goto('https://www.cinecolombia.com/bogota/cartelera', { waitUntil: 'networkidle', timeout: 30000 });
  } catch(e) {}
  
  await browser.close();
}
main().catch(console.error);
