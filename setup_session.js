const { chromium } = require('playwright');
require('dotenv').config();

(async () => {
  console.log('Membuka browser untuk login...');
  // Menggunakan channel 'chrome' (browser Chrome asli di laptopmu)
  // Ini membantu mem-bypass blokir "Browser not secure" dari Google
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Matikan timeout default bawaan playwright (30 detik) menjadi tidak terbatas
  page.setDefaultTimeout(0);

  console.log('Navigasi ke tiket.com...');
  await page.goto('https://www.tiket.com/login', { waitUntil: 'domcontentloaded' });

  console.log('Silakan login secara manual di browser yang terbuka (Bisa pakai Google Login sekarang).');
  console.log('Setelah login berhasil dan kamu berada di halaman utama, skrip ini akan menyimpan sesimu secara otomatis.');

  try {
    // Menunggu sampai URL berubah ke halaman depan dan tidak di /login
    await page.waitForFunction(() => {
      return !window.location.href.includes('/login') && document.readyState === 'complete';
    }); 


    console.log('Login terdeteksi! Menyimpan sesi...');
    // Tunggu sebentar agar cookie/token benar-benar tersimpan
    await page.waitForTimeout(3000); 

    await context.storageState({ path: 'session.json' });
    console.log('Sesi berhasil disimpan ke session.json!');
    
  } catch (error) {
    console.error('Gagal menyimpan sesi:', error);
  } finally {
    await browser.close();
    console.log('Browser ditutup.');
  }
})();
