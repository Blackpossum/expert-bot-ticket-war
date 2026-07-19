const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');

const TARGET_URL = process.env.CONCERT_URL;
const TARGET_CATEGORY = process.env.TARGET_CATEGORY || 'VIP PACKAGE A - WEVERSE';
const TICKET_QUANTITY = parseInt(process.env.TICKET_QUANTITY || '1', 10);

// ── UTILITY: RETRY WITH EXPONENTIAL BACKOFF ────────────────────────────────
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⚠️ Attempt ${attempt} failed, retry in ${delay}ms...`);
      await page.waitForTimeout(delay);
    }
  }
}

function normalizeTitle(title) {
  if (!title) return 'Mr';
  const t = title.toLowerCase().replace(/\./g, '').trim();
  if (t === 'mr' || t === 'tuan') return 'Mr';
  if (t === 'mrs' || t === 'nyonya') return 'Mrs';
  if (t === 'ms' || t === 'nona') return 'Ms';
  return 'Mr';
}

// Helper: minta input OTP dari terminal secara interaktif
function askOTP(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

(async () => {
   if (!fs.existsSync('session.json')) {
     console.error('Sesi tidak ditemukan! Silakan jalankan `npm run setup` terlebih dahulu.');
     process.exit(1);
   }

console.log('Mempersiapkan amunisi untuk war tiket...');
    
    const browser = await chromium.launch({ 
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation']
    });
    const context = await browser.newContext({ storageState: 'session.json' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000); // 10 detik timeout per aksi agar tidak hang selamanya

    // ── SOLUSI SESSION EXPIRE ───────────────────────────────────────────────────
    // Cara pakai Chrome existing yang sudah login:
    // 1. Buka Chrome dengan: google-chrome --remote-debugging-port=9222
    // 2. Login manual ke tiket.com di Chrome itu
    // 3. Ganti kode browser launch jadi:
    //    const browser = await chromium.connect({ wsEndpoint: 'ws://localhost:9222/devtools/browser' });
    //    const context = await browser.newContext(); // tanpa storageState
    
    // CEK VALIDITAS SESSION (simplified)
    console.log('🔍 Memeriksa validitas session...');
    try {
      await page.goto('https://www.tiket.com', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const loginIndicators = ['text=Masuk', 'text=Login', 'a[href*="/login"]', 'button:has-text("Masuk")'];
      let loginFound = false;
      for (const sel of loginIndicators) {
        if (await page.locator(sel).count() > 0 && await page.locator(sel).first().isVisible()) {
          loginFound = true;
          break;
        }
      }
      if (loginFound) {
        console.log('⚠️ Session expired! Harap login ulang via npm run setup');
        // Tidak exit dulu, biarkan user decide
      } else {
        console.log('✅ Session masih valid!');
      }
    } catch (e) {
      console.log('⚠️ Gagal cek session, lanjutkan saja...', e.message);
    }

  console.log(`Meluncur ke: ${TARGET_URL}`);
  
  async function handleQueue() {
    // Deteksi elemen antrian/queue di tiket.com (versi lebih robust)
    const queueSelectors = [
      // Full page modal/toast
      '[class*="Modal"][class*="queue" i], [class*="modal"][class*="queue" i]',
      '[class*="QueueModal"], [class*="queue-modal"]',
      'div:has-text("Anda berada di urutan antrian")',
      'div:has-text("urutan antrian")',
      // Toast/loading bar
      '[class*="Toast"][class*="queue" i], [class*="toast"][class*="queue" i]',
      '[class*="Snackbar"][class*="queue" i], [class*="snackbar"][class*="queue" i]',
      // Loading skeleton with queue
      '[class*="Skeleton"]:has-text("antrian"), [class*="skeleton"]:has-text("queue")',
      // Generic indicators
      'text="Waiting", text="Please wait", text="Mohon tunggu"',
      'text=/\\d+\\. Anda/i', // pola "1. Anda", "2. Anda" dll
      'text=/\\(sedang menunggu\\)/i',
    ];
    
    for (const selector of queueSelectors) {
      const el = page.locator(selector).first();
      try {
        if (await el.isVisible()) {
          const text = (await el.innerText() || '').trim();
          console.log(`🚦 TERDETEKSI ANTRIAN: "${text.substring(0, 80)}..."`);
          console.log('⏳ Bot akan menunggu hingga keluar dari antrian...');
          
          // Loop tunggu sampai elemen antrian hilang, dengan update log
          let waitCount = 0;
          while (await el.isVisible()) {
            waitCount++;
            const waitTime = 3000;
            // Coba ekstrak posisi antrian & estimasi jika ada
            const currentText = (await el.innerText() || '').trim();
            const posMatch = currentText.match(/(\d+)[.)]\s*Anda|urutan\s*(\d+)|posisi[\s:]*(\d+)|nomor[\s:]*(\d+)/i);
            const estMatch = currentText.match(/(estimasi|estimate|waktu|time)[\s:]*(\d+)/i);
            
            if (posMatch || estMatch) {
              const pos = posMatch ? (posMatch[1] || posMatch[2] || posMatch[3] || posMatch[4]) : '-';
              const est = estMatch ? (estMatch[2] || '-') : '-';
              console.log(`🔄 [${waitCount}] Posisi antrian: ${pos}, Estimasi: ${est} detik...`);
            } else {
              console.log(`🔄 [${waitCount}] Masih dalam antrian, tunggu...`);
            }
            await page.waitForTimeout(waitTime);
          }
          console.log('✅ Keluar dari antrian! Melanjutkan proses...');
          return true;
        }
      } catch (_) {
        continue;
      }
    }
    return false;
  }

// ── DETEKSI COUNTDOWN TIMER ───────────────────────────────────────────────────
  async function handleCountdownTimer() {
    // Cari semua elemen dengan format waktu countdown (HH:MM:SS)
    const countdownElements = page.locator('span, div').filter({ hasText: /Buy ticket in \d{1,2}:\d{2}:\d{2}/i });
    
    const count = await countdownElements.count();
    for (let i = 0; i < count; i++) {
      const el = countdownElements.nth(i);
      try {
        if (await el.isVisible()) {
          const text = (await el.innerText() || '').trim();
          if (text.match(/Buy ticket in \d{1,2}:\d{2}:\d{2}/i)) {
            console.log(`⏰ TERDETEKSI COUNTDOWN TIMER: "${text}"`);
            
            // Parse waktu countdown
            const timeMatch = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
            if (timeMatch) {
              const hours = parseInt(timeMatch[1]) || 0;
              const minutes = parseInt(timeMatch[2]) || 0;
              const seconds = parseInt(timeMatch[3]) || 0;
              const totalSeconds = hours * 3600 + minutes * 60 + seconds;
              console.log(`⏳ Estimasi waktu tersisa: ${hours}j ${minutes}m ${seconds}d (${totalSeconds} detik)...`);
            }
            
            // Tunggu sampai elemen countdown hilang
            while (true) {
              try {
                const currentText = (await el.innerText() || '').trim();
                const currentMatch = currentText.match(/Buy ticket in (\d{1,2}:\d{2}:\d{2})/i);
                
                if (!currentMatch) {
                  console.log('✅ Countdown selesai! Melanjutkan...');
                  return true;
                }
                
                // Log tiap 30 detik atau akhir countdown
                const h = parseInt(currentMatch[1].split(':')[0]) || 0;
                const m = parseInt(currentMatch[1].split(':')[1]) || 0;
                const s = parseInt(currentMatch[1].split(':')[2]) || 0;
                const totalLeft = h * 3600 + m * 60 + s;
                if (totalLeft % 30 === 0 || totalLeft < 60) {
                  console.log(`🔄 Countdown masih berjalan: ${currentText}`);
                }
              } catch (e) {
                console.log('✅ Elemen countdown hilang! Melanjutkan...');
                return true;
              }
              await page.waitForTimeout(1000);
            }
          }
        }
      } catch (_) {}
    }
    return false;
  }

  // ── DETEKSI CAPTCHA NON-CLOUDFLARE (reCAPTCHA/hCaptcha) ───────────────────────────
  async function handleCaptcha() {
    const captchaSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '[class*="grecaptcha"]',
      '[class*="h-captcha"]',
      'div:has-text("reCAPTCHA")',
      'div:has-text("hCaptcha")',
    ];
    
    for (const selector of captchaSelectors) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const isVisible = await el.isVisible().catch(() => false);
        if (isVisible) {
          console.log('🚨 TERDETEKSI CAPTCHA (reCAPTCHA/hCaptcha)!');
          console.log('⚠️ Harap selesaikan captcha secara manual. Bot menunggu...');
          await el.waitFor({ state: 'hidden', timeout: 0 });
          console.log('✅ Captcha selesai! Melanjutkan...');
          return true;
        }
      }
    }
    return false;
  }

async function waitForTicket() {
    let available = false;
    let queueLogged = false;
    while (!available) {
      try {
        console.log(`🌐 Mengunjungi: ${TARGET_URL}`);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        
        // Validasi: pastikan benar di halaman event (bukan help atau halaman lain)
        const pageTitle = await page.title().catch(() => '');
        const currentUrl = page.url();
        console.log(`📄 Halaman: "${pageTitle}" | URL: ${currentUrl.substring(0, 80)}...`);
        
        // Jika bukan halaman event, coba cari link event
        const eventPageIndicators = ['event', 'concert', 'ticket', 'tiket'];
        const isEventPage = eventPageIndicators.some(ind => 
          pageTitle.toLowerCase().includes(ind) || currentUrl.toLowerCase().includes(ind)
        );
        if (!isEventPage) {
          console.log('⚠️ Bukan halaman event, mencoba cari link event...');
          const eventLinks = page.locator('a[href*="event"], a[href*="concert"], a[href*="ticket"]');
          if (await eventLinks.count() > 0) {
            const eventLink = eventLinks.first();
            const href = await eventLink.getAttribute('href').catch(() => '');
            if (href) {
              const eventUrl = href.startsWith('http') ? href : `https://www.tiket.com${href}`;
              console.log(`🔗 Redirect ke halaman event: ${eventUrl}`);
              await page.goto(eventUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForTimeout(2000);
              continue;
            }
          }
        }
        
        // 0. CEK COUNTDOWN TIMER
        const inCountdown = await handleCountdownTimer();
        if (inCountdown) {
          console.log('⏳ Countdown selesai, menunggu sebentar untuk halaman update...');
          await page.waitForTimeout(3000);
          continue;
        }

        // 0.5 CEK CAPTCHA LAIN (reCAPTCHA/hCaptcha)
        await handleCaptcha();

        // 1. CEK CAPTCHA CLOUDFLARE
        const captchaText = page.locator('text="Robot atau manusia?", text="verifikasi bahwa kamu manusia"');
        if (await captchaText.count() > 0 && await captchaText.first().isVisible()) {
          console.log('🚨 TERTETEKSI CAPTCHA CLOUDFLARE! Silakan centang secara manual. Bot menunggu...');
          await captchaText.first().waitFor({ state: 'hidden', timeout: 0 });
          console.log('Captcha selesai! Melanjutkan...');
        }

        // 2. CEK TOMBOL "BUY TICKET NOW" DI HALAMAN DEPAN
        const mainBuyButton = page.locator('button:has-text("Find Ticket"), button:has-text("Buy Ticket Now"), button:has-text("Pilih Tiket"), a:has-text("Find Ticket"), a:has-text("Buy Ticket Now")').first();
        
        if (await mainBuyButton.isVisible()) {
          await retryWithBackoff(async () => {
            if (await mainBuyButton.isVisible()) {
              await mainBuyButton.click();
            } else {
              throw new Error('Tombol tidak visible pas di-klik');
            }
          });
          await page.waitForTimeout(2000);
          available = true;
          break;
        }

        // 3. JIKA TOMBOL UTAMA TIDAK ADA, CEK APAKAH TIKET SUDAH MUNCUL
        const categoryLabel = page.locator(`text=${TARGET_CATEGORY}`).first();
        if (await categoryLabel.isVisible()) {
          console.log('✓ Kategori tiket sudah terlihat di halaman! Lanjut ke pemilihan...');
          available = true;
          break;
        }

        console.log('❌ Belum tersedia (atau salah link), me-refresh halaman...');
        await page.waitForTimeout(1000); 
      } catch (e) {
        console.log('Error saat memuat halaman, mencoba lagi...', e.message);
      }
    }
  }

  await waitForTicket();

// ── CEK VERIFIKASI KODE MEMBERSHIP / PRESALE ──────────────────────────────
   // Beberapa event mengharuskan memasukkan kode membership/presale pribadi
   // sebelum bisa memilih jumlah tiket.
   console.log('\n--- CEK VERIFIKASI KODE MEMBERSHIP ---');
   try {
    // Deteksi form verifikasi kode — cari input dengan placeholder/label
    // yang mengandung kata "kode", "code", "verifikasi", dsb.
    const codeInput = page.locator([
      'input[placeholder*="kodemu"]',
      'input[placeholder*="Kodemu"]',
      'input[placeholder*="kode"]',
      'input[placeholder*="Kode"]',
      'input[placeholder*="code"]',
      'input[placeholder*="Code"]',
      'input[placeholder*="membership"]',
      'input[placeholder*="Membership"]',
      'input[placeholder*="presale"]',
      'input[placeholder*="Presale"]',
    ].join(', ')).first();

// Cek dalam waktu singkat (3 detik) — tidak blocking kalau tidak ada
     let codeFormFound = false;
     try {
       await codeInput.waitFor({ state: 'visible', timeout: 3000 });
       codeFormFound = true;
     } catch (_) {
       codeFormFound = false;
     }

     if (codeFormFound) {
       // ── CASE: ADA FORM KODE MEMBERSHIP ───────────────────────────────────
       console.log('🚩 TERDETEKSI FORM VERIFIKASI KODE MEMBERSHIP!');

       let memberCode = process.env.MEMBER_CODE || '';
       if (!memberCode) {
         // Kalau MEMBER_CODE kosong di .env, minta input manual di terminal
         console.log('⚠️  MEMBER_CODE tidak diset di .env!');
         memberCode = await askOTP('🔢 Masukkan kode membership/presale kamu: ');
       }

       if (memberCode) {
         // Isi kode ke input
         await codeInput.fill(memberCode);
         console.log(`✓ Kode "${memberCode}" berhasil dimasukkan.`);

         // Klik tombol "Verifikasi Kodemu" / "Verify Code" / sejenisnya
         const verifyBtn = page.locator([
           'button:has-text("Verifikasi Kodemu")',
           'button:has-text("Verifikasi kode")',
           'button:has-text("Verifikasi")',
           'button:has-text("Verify Code")',
           'button:has-text("Verify")',
           'button:has-text("Konfirmasi")',
           'button:has-text("Confirm")',
           'button:has-text("Submit")',
           'button[type="submit"]',
         ].join(', ')).first();

         if (await verifyBtn.isVisible()) {
           await verifyBtn.click();
           console.log('✓ Tombol verifikasi diklik! Menunggu respons...');
           await page.waitForTimeout(2000); // tunggu halaman update setelah verifikasi
           console.log('✓ Verifikasi selesai. Lanjut ke pemilihan tiket...');
         } else {
           console.log('⚠️ Tombol verifikasi tidak ditemukan, mencoba tekan Enter...');
           await codeInput.press('Enter');
           await page.waitForTimeout(2000);
         }
       } else {
         console.log('⚠️ Kode kosong, melewati verifikasi...');
       }
     } else {
       // ── CASE: TIDAK ADA FORM KODE ─────────────────────────────────────────
       console.log('✓ Tidak ada verifikasi kode membership. Lanjut ke pemilihan tiket...');
     }
   } catch (e) {
     console.log('ℹ️  Pengecekan kode membership selesai:', e.message);
   }

// ── DETEKSI SEAT MAP (PEMILIHAN KURSI) ─────────────────────────────────
  async function handleSeatMap() {
    const seatSelectors = [
      'div[class*="seat-map"], div[class*="SeatMap"]',
      '[data-testid*="seat"], [data-testid*="Seat"]',
      '.seat-map-container',
      'div:has-text("Pilih Kursi"), div:has-text("Select Seat")',
    ];
    
    for (const selector of seatSelectors) {
      const el = page.locator(selector).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        console.log('🪑 TERDETEKSI SEAT MAP! Bot akan mencari kursi tersedia...');
        await page.waitForTimeout(2000);
        
        // Cari kursi yang tersedia (biasanya tidak memiliki kelas disabled/occupied)
        const availableSeat = page.locator('[class*="seat"]:not([class*="disabled"]):not([class*="occupied"]):not(.selected)').first();
        const occupiedSeat = page.locator('[class*="seat"][class*="disabled"], [class*="seat"][class*="occupied"], [class*="seat"].selected').first();
        
        if (await availableSeat.count() > 0) {
          await availableSeat.click();
          console.log('✅ Kursi terpilih!');
        }
        return true;
      }
    }
    return false;
  }

  // Memilih kategori tiket - otomatis pilih yang tersedia paling atas
   console.log('\n--- FASE PEMILIHAN TIKET OTOMATIS ---');
   
   try {
     console.log('🔍 Mencari kategori tiket yang tersedia...');
     
     // Ambil semua tombol aksi (+/Pilih/Select) - urutan DOM = urutan kategori
     const allActionBtns = page.locator('button:has-text("+"), button:has-text("Pilih"), a:has-text("Pilih"), button:has-text("Select"), a:has-text("Select"), button:has-text("Buy"), a:has-text("Buy")');
     const btnCount = await allActionBtns.count();
     
     if (btnCount === 0) {
       throw new Error("Tidak ada tombol aksi tiket yang ditemukan.");
     }
     
     // Pilih tombol pertama yang tersedia (kategori paling atas)
     const firstBtn = allActionBtns.first();
     const card = firstBtn.locator('xpath=ancestor::div[contains(@class,"ticket") or contains(@class,"Ticket") or contains(@class,"category") or position()<=5]').first();
     const cardText = (await card.innerText() || '').trim().split('\n')[0] || 'Unknown';
     
     console.log(`✅ Menemukan kategori tersedia: "${cardText}"`);
     
     const plusButton = card.locator('button:has-text("+"), button[aria-label*="Tambah"], button[aria-label*="Add"]');
     const selectBtn = card.locator('button:has-text("Pilih"), a:has-text("Pilih"), button:has-text("Select"), a:has-text("Select"), button:has-text("Buy"), a:has-text("Buy"), button[type="submit"]');
     
     if (await plusButton.count() > 0) {
       console.log(`✓ Tombol "+" ditemukan! Klik ${TICKET_QUANTITY} kali.`);
       for (let i = 0; i < TICKET_QUANTITY; i++) {
         await retryWithBackoff(() => plusButton.first().click());
         await page.waitForTimeout(200);
       }
     } else if (await selectBtn.count() > 0) {
       console.log(`✓ Tombol "Select"/"Pilih" ditemukan! Mengklik...`);
       await retryWithBackoff(() => selectBtn.first().click());
     } else {
       await retryWithBackoff(() => firstBtn.click());
       console.log('✓ Klik tombol aksi utama.');
     }
     
// Handle seat map jika muncul
      await page.waitForTimeout(1500);
      await handleSeatMap();
      
      await page.waitForTimeout(1000); // Tunggu drawer / bottom bar muncul

      // Lanjut ke pemesanan (Checkout)
      console.log('\n--- FASE CHECKOUT ---');
      console.log('Mencari tombol checkout (Pesan / Lanjut / Book / Next)...');
      const checkoutButton = page.locator('button:has-text("Pesan"), a:has-text("Pesan"), button:has-text("Lanjut"), button:has-text("Book"), button:has-text("Next"), a:has-text("Next")').first();
    
      if (await checkoutButton.isVisible()) {
        await retryWithBackoff(() => checkoutButton.click());
        console.log('✓ Berhasil mengklik tombol Checkout / Lanjut!');
      } else {
        console.log('⚠️ GAGAL: Tidak menemukan tombol Checkout. (Mungkin bot butuh selector tambahan)');
      }
    
// Autofill Detail Kontak & Detail Pengunjung
      console.log('\n--- FASE PENGISIAN DATA PEMESAN ---');
      console.log('Menunggu formulir Detail Kontak...');
      
      // Tunggu input nama pemesan muncul secara dinamis (max 10 detik)
      const contactName = page.locator('input[name="contactDetails.fullname"]');
      await contactName.waitFor({ state: 'visible', timeout: 10000 });

      const titleVal = normalizeTitle(process.env.BUYER_TITLE);
      
      // 1. Fill Contact Details Title
      const contactTitle = page.locator(`input[name="contactDetails.salutation"][value='"${titleVal}"']`);
      if (await contactTitle.isVisible()) {
        await contactTitle.click({ force: true });
        console.log('✓ Title pemesan berhasil dipilih.');
      }

      // 2. Fill Contact Details Name
      if (await contactName.isVisible()) {
        await contactName.fill(process.env.BUYER_FIRST_NAME + ' ' + (process.env.BUYER_LAST_NAME || ''));
        console.log('✓ Nama pemesan berhasil diisi.');
      }

      // 3. Fill Contact Details Phone
      const contactPhone = page.locator('input#mobile-number');
      if (await contactPhone.isVisible()) {
        let phone = process.env.BUYER_PHONE || '';
        if (phone.startsWith('+62')) phone = phone.substring(3);
        else if (phone.startsWith('62')) phone = phone.substring(2);
        else if (phone.startsWith('0')) phone = phone.substring(1);
        await contactPhone.fill(phone);
        console.log('✓ Nomor telepon pemesan berhasil diisi.');
      }

      // 4. Fill Contact Details Country/Region (Nationality)
      const countryDropdown = page.locator('#countryregion-of-residence');
      if (await countryDropdown.isVisible()) {
        await countryDropdown.click();
        
        const indonesiaItem = page.locator('div[class*="CountryListSelection_list_item"]').filter({ hasText: /^Indonesia/ }).first();
        try {
          await indonesiaItem.waitFor({ state: 'visible', timeout: 300 });
        } catch (e) {
          const searchInput = page.locator('div[class*="CountryListSelection_search_box_container"] input');
          if (await searchInput.isVisible()) {
            await searchInput.fill('Indonesia');
            await indonesiaItem.waitFor({ state: 'visible', timeout: 2000 });
          }
        }
        
        await retryWithBackoff(() => indonesiaItem.click());
        console.log('✓ Negara asal berhasil dipilih: Indonesia');
      }

// 5. Fill Visitor Details
       console.log('\n--- FASE PENGISIAN DATA PENGUNJUNG ---');
       const sameCheckbox = page.locator('input[type="checkbox"]').first();
       if (await sameCheckbox.isVisible()) {
         const isChecked = await sameCheckbox.isChecked();
         if (!isChecked) {
           await sameCheckbox.click({ force: true });
           console.log('✓ Mencentang "Sama dengan detail pemesan".');
           await page.waitForTimeout(100);
         }
       }

       for (let i = 0; i < TICKET_QUANTITY; i++) {
         const visitorTitle = page.locator(`input[name="salutation-${i}"][value='"${titleVal}"']`);
         if (await visitorTitle.isVisible()) {
           const isChecked = await visitorTitle.isChecked();
           if (!isChecked) {
             await visitorTitle.click({ force: true });
           }
         }
         
         const visitorName = page.locator('input#full-name:not([name="contactDetails.fullname"])').nth(i);
         if (await visitorName.isVisible()) {
           await visitorName.fill(process.env.BUYER_FIRST_NAME + ' ' + (process.env.BUYER_LAST_NAME || ''));
         }
         
         // Multiple fallback selector untuk NIK
         const identitySelectors = [
           'input#identity-card-number',
           'input#nik',
           'input[name*="identity"]',
           'input[name*="nik"]',
           'input[placeholder*="identitas"]',
           'input[placeholder*="NIK"]',
           'input[placeholder*="Identity"]',
         ];
         let identityFilled = false;
         for (const sel of identitySelectors) {
           const visitorIdentity = page.locator(sel).nth(i);
           try {
             if (await visitorIdentity.isVisible()) {
               await visitorIdentity.fill(process.env.BUYER_IDENTITY_NUMBER || '');
               console.log(`✓ Nomor identitas pengunjung ${i + 1} berhasil diisi.`);
               identityFilled = true;
               break;
             }
           } catch (_) {}
         }
         if (!identityFilled) {
           console.log(`⚠️ Input NIK untuk pengunjung ${i + 1} tidak ditemukan.`);
         }
       }

// 6. Click Continue to Payment button
      console.log('\n--- LANTAS KE PEMBAYARAN ---');
      const proceedBtn = page.locator('button:has-text("Continue to payment"), button:has-text("Lanjut ke pembayaran"), a:has-text("Continue to payment"), a:has-text("Lanjut ke pembayaran")').first();
      try {
        await proceedBtn.waitFor({ state: 'visible', timeout: 5000 });
        await retryWithBackoff(() => proceedBtn.click());
        console.log('✓ Berhasil meluncur ke halaman pembayaran!');
      } catch (e) {
        console.log('⚠️ Tombol proceed tidak ditemukan, mencoba fallback...');
      }

      // 7. Pilih BCA Virtual Account sebagai metode pembayaran
      console.log('\n--- MEMILIH METODE PEMBAYARAN: BCA Virtual Account ---');
      await page.waitForTimeout(2000);

      try {
        const bcaTile = page.locator('div[class*="PaymentTile_selected_payment_tile"]').filter({ hasText: 'BCA Virtual Account' }).first();
        await bcaTile.waitFor({ state: 'visible', timeout: 10000 });

        const bcaRadio = bcaTile.locator('input[name="selected-payment"]');
        await retryWithBackoff(() => bcaRadio.click({ force: true }));
        console.log('✓ BCA Virtual Account berhasil dipilih!');
      } catch (e) {
        console.log('⚠️ Strategi utama gagal, mencoba fallback...', e.message);
        const allTiles = page.locator('div[class*="PaymentTile_selected_payment_tile"]');
        const count = await allTiles.count();
        let clicked = false;
        for (let i = 0; i < count; i++) {
          const tile = allTiles.nth(i);
          const text = await tile.innerText();
          if (text.includes('BCA Virtual Account')) {
            const radio = tile.locator('input[type="radio"]').first();
            await retryWithBackoff(() => radio.click({ force: true }));
            console.log(`✓ BCA Virtual Account dipilih via loop tile index ${i}!`);
            clicked = true;
            break;
          }
        }
        if (!clicked) console.log('❌ GAGAL menemukan tile BCA Virtual Account!');
      }

      await page.waitForTimeout(1000);

      // 8. Klik tombol "Pay Now" / "Bayar Sekarang"
      console.log('\n--- KLIK PAY NOW ---');
      const payNowBtn = page.locator([
        'button:has-text("Pay Now")',
        'button:has-text("Bayar Sekarang")',
        'button:has-text("Bayar")',
        'a:has-text("Pay Now")',
        'a:has-text("Bayar Sekarang")',
        'button:has-text("Konfirmasi Pembayaran")',
        'button:has-text("Confirm Payment")',
      ].join(', ')).first();

      try {
        await payNowBtn.waitFor({ state: 'visible', timeout: 10000 });
        await retryWithBackoff(() => payNowBtn.click());
        console.log('✓ Tombol Pay Now berhasil diklik! Menunggu instruksi VA...');
      } catch (e) {
        console.log('❌ GAGAL menemukan tombol Pay Now:', e.message);
      }
      
      console.log('\n==================================================');
      console.log('BOT SELESAI MENGISI FORMULIR & MEMASUKI PAYMENT!');
      console.log('SILAKAN SELESAIKAN PEMBAYARAN SECARA MANUAL!');
      console.log('Browser akan tetap terbuka. JANGAN DITUTUP!');
      console.log('==================================================');

    } catch (err) {
      console.error('\n❌ Terjadi kesalahan saat memproses tiket:', err.message);
      // Screenshot untuk debug
      try {
        const timestamp = Date.now();
        await page.screenshot({ path: `error_debug_${timestamp}.png` });
        console.log(`📸 Screenshot tersimpan: error_debug_${timestamp}.png`);
      } catch (screenshotErr) {
        console.log('⚠️ Gagal screenshot:', screenshotErr.message);
      }
    } finally {
      // Update session untuk reuse
      try {
        await context.storageState({ path: 'session.json' });
        console.log('💾 Session diperbarui.');
      } catch (_) {}
    }

})();
