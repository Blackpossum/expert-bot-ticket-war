const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.tiket.com/en-id/to-do/badan-pom-x-acaraki-jamu-festival', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  try {
    const loc = page.locator('text="Zumba"').last();
    // Get the outer HTML of the parent div that likely contains the whole card
    // Go up 4 levels to get a good chunk of the card DOM
    const html = await loc.evaluate((el) => {
      let curr = el;
      for (let i = 0; i < 5; i++) {
        if (curr.parentElement) curr = curr.parentElement;
      }
      return curr.outerHTML;
    });
    console.log(html);
  } catch(e) {
    console.log("Error dumping:", e.message);
  }
  
  await browser.close();
})();
