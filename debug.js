const { chromium } = require('playwright');

(async () => {
  console.log('Membuka browser untuk debugging...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Membuka URL...');
  await page.goto('https://www.tiket.com/en-id/to-do/badan-pom-x-acaraki-jamu-festival', { waitUntil: 'domcontentloaded' });
  
  console.log('Menunggu 3 detik agar page render...');
  await page.waitForTimeout(3000);

  console.log('\n--- Daftar Teks pada Tombol & Link ---');
  const elements = await page.locator('button, a, [role="button"], div').all();
  const seenTexts = new Set();
  
  for (const el of elements) {
    try {
      if (await el.isVisible()) {
        const text = await el.innerText();
        const cleanText = text.trim().replace(/\n/g, ' ');
        if (cleanText.length > 0 && cleanText.length < 50 && !seenTexts.has(cleanText)) {
          console.log(`[Elemen]: ${cleanText}`);
          seenTexts.add(cleanText);
        }
      }
    } catch (e) {
      // ignore detached elements
    }
  }

  console.log('\n--- Sedikit Teks dari Halaman Utama ---');
  const bodyText = await page.innerText('body');
  console.log(bodyText.substring(0, 1000));
  
  await browser.close();
  console.log('Selesai debugging.');
})();
