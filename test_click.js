const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });
  const page = await browser.newPage();
  
  await page.goto('https://www.tiket.com/en-id/to-do/badan-pom-x-acaraki-jamu-festival', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  const mainBuyButton = page.locator('button:has-text("Find Ticket"), button:has-text("Buy Ticket Now"), button:has-text("Pilih Tiket"), a:has-text("Find Ticket"), a:has-text("Buy Ticket Now")').first();
  if (await mainBuyButton.isVisible()) {
    console.log("Mengklik main button...");
    await mainBuyButton.click();
    await page.waitForTimeout(3000);
  }

  console.log("Mengklik tiket Zumba...");
  const ticketElement = page.locator('button, a, div[role="button"]').filter({ hasText: 'Zumba' }).first();
  if (await ticketElement.isVisible()) {
    await ticketElement.click();
    await page.waitForTimeout(2000);
  }

  console.log("--- ALL VISIBLE BUTTONS AFTER CLICKING TICKET ---");
  const buttons = await page.locator('button, a, [role="button"], div').all();
  const seen = new Set();
  for (const b of buttons) {
    try {
      if (await b.isVisible()) {
        const text = await b.innerText();
        const clean = text.trim().replace(/\n/g, ' ');
        if (clean && clean.length < 50 && !seen.has(clean)) {
          console.log(`BUTTON/LINK: "${clean}"`);
          seen.add(clean);
        }
      }
    } catch(e) {}
  }

  await browser.close();
})();
