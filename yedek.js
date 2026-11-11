/* Ders Takip — Excel (.xlsx) yedeği. Dosya tamamen cihazda üretilir; dışarıdan kütüphane yüklenmez. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Yedek = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /** Sıkıştırmasız zip. dosyalar: [{ad, veri:Uint8Array}] */
  function zip(dosyalar) {
    var parcalar = [], merkez = [], ofset = 0;
    function u16(n) { return [n & 255, (n >>> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    dosyalar.forEach(function (d) {
      var ad = utf8(d.ad), crc = crc32(d.veri), n = d.veri.length;
      var ortak = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(n), u32(n), u16(ad.length), u16(0));
      var yerel = new Uint8Array([0x50, 0x4B, 0x03, 0x04].concat(ortak));
      parcalar.push(yerel, ad, d.veri);
      merkez.push({ bas: new Uint8Array([0x50, 0x4B, 0x01, 0x02].concat(u16(20), ortak, u16(0), u16(0), u16(0), u32(0), u32(ofset))), ad: ad });
      ofset += yerel.length + ad.length + n;
    });
    var mBoy = 0;
    merkez.forEach(function (m) { parcalar.push(m.bas, m.ad); mBoy += m.bas.length + m.ad.length; });
    parcalar.push(new Uint8Array([0x50, 0x4B, 0x05, 0x06].concat(u16(0), u16(0), u16(dosyalar.length), u16(dosyalar.length), u32(mBoy), u32(ofset), u16(0))));
    var toplam = 0; parcalar.forEach(function (p) { toplam += p.length; });
    var out = new Uint8Array(toplam), k = 0;
    parcalar.forEach(function (p) { out.set(p, k); k += p.length; });
    return out;
  }

  function x(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sayfaXml(sayfa) {
    var s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    s += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    if (sayfa.genislik && sayfa.genislik.length) {
      s += '<cols>';
      sayfa.genislik.forEach(function (g, i) { s += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + g + '" customWidth="1"/>'; });
      s += '</cols>';
    }
    s += '<sheetData>';
    sayfa.satirlar.forEach(function (satir, r) {
      s += '<row r="' + (r + 1) + '">';
      satir.forEach(function (v, c) {
        var st = ' r="' + String.fromCharCode(65 + c) + (r + 1) + '"' + (r === 0 ? ' s="1"' : '');
        if (typeof v === 'number' && isFinite(v)) s += '<c' + st + '><v>' + v + '</v></c>';
        else if (v === '' || v === null || v === undefined) s += '<c' + st + '/>';
        else s += '<c' + st + ' t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
      });
      s += '</row>';
    });
    return s + '</sheetData></worksheet>';
  }

  /** sayfalar: [{ad, genislik, satirlar}] → Uint8Array (.xlsx) */
  function xlsx(sayfalar) {
    var B = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var ct = B + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    var wb = B + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    var rel = B + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    var dosyalar = [];
    sayfalar.forEach(function (sf, i) {
      var n = i + 1;
      ct += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wb += '<sheet name="' + x(sf.ad) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      rel += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      dosyalar.push({ ad: 'xl/worksheets/sheet' + n + '.xml', veri: utf8(sayfaXml(sf)) });
    });
    ct += '</Types>'; wb += '</sheets></workbook>';
    rel += '<Relationship Id="rId' + (sayfalar.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var stil = B + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
    var kok = B + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    return zip([
      { ad: '[Content_Types].xml', veri: utf8(ct) },
      { ad: '_rels/.rels', veri: utf8(kok) },
      { ad: 'xl/workbook.xml', veri: utf8(wb) },
      { ad: 'xl/_rels/workbook.xml.rels', veri: utf8(rel) },
      { ad: 'xl/styles.xml', veri: utf8(stil) }
    ].concat(dosyalar));
  }

  return { xlsx: xlsx, zip: zip, crc32: crc32 };
});
