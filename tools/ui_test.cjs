// Teste de ponta a ponta: importa o .pbix pela interface e tira prints de cada página.
const { chromium } = require('playwright');
const pbix = process.argv[2], out = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:7878/');
  await page.waitForSelector('.ribbon');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Importar .pbix')]);
  await chooser.setFiles(pbix);
  await page.waitForSelector('text=Importação concluída', { timeout: 60000 });
  await page.screenshot({ path: `${out}/0-import.png` });
  await page.click('button.primary:has-text("OK")');
  const tabs = await page.$$('.page-tab:not(.add)');
  for (let i = 0; i < tabs.length; i++) {
    await (await page.$$('.page-tab:not(.add)'))[i].click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/page-${i + 1}.png` });
  }
  console.log('tabs', tabs.length);
  console.log(errors.slice(0, 20).join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
