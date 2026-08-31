import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

(async () => {
  try {
    const data = new Uint8Array(fs.readFileSync('invoice_38_final.pdf'));
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    if (text.includes('Minibar')) {
      console.log('Found Minibar in PDF text');
    } else {
      console.log('Minibar not found in PDF text');
      console.log('--- PDF text preview ---');
      console.log(text.slice(0, 2000));
    }
  } catch (e) {
    console.error('Error extracting PDF text', e);
    process.exit(1);
  }
})();