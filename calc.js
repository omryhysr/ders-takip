/* Ders Takip — hesap mantığı (tarayıcıda ve testte ortak) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hesap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var TZ = 'Europe/Istanbul';
  var AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var SINIFLAR = ['1. sınıf', '2. sınıf', '3. sınıf', '4. sınıf', '5. sınıf', '6. sınıf', '7. sınıf', '8. sınıf', '9. sınıf', '10. sınıf', '11. sınıf', '12. sınıf', 'Mezun', 'Üniversite', 'Diğer'];
  var ODEME_ETIKET = { hayir: 'Ödeme almadım', nakit: 'Elden aldım', havale: 'EFT ile aldım' };
  var YONTEM_ETIKET = { nakit: 'Elden', havale: 'EFT' };
  var ODEV_ETIKET = { yapti: 'Yaptı', kismen: 'Kısmen', yapmadi: 'Yapmadı' };
  var TIP_ETIKET = { ogrenci: 'Öğrenci', ders: 'Ders', odeme: 'Ödeme', deneme: 'Deneme' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function yuvarla(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /** Bugünün tarihi, İstanbul saatine göre, 'yyyy-aa-gg' */
  function bugun(simdi) {
    var d = simdi || new Date();
    try {
      return d.toLocaleDateString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }

  function formatTarih(iso) {
    if (!iso || iso.length < 10) return iso || '';
    return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
  }

  function formatSayi(n) {
    n = yuvarla(n);
    try { return n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    catch (e) { return String(n); }
  }
  function formatTL(n) { return formatSayi(n) + ' ₺'; }

  function ayAdi(iso) { // 'yyyy-aa' veya 'yyyy-aa-gg'
    return AYLAR[parseInt(iso.slice(5, 7), 10) - 1] + ' ' + iso.slice(0, 4);
  }

  function gunFarki(a, b) { // b - a, gün
    var x = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
    var y = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
    return Math.round((y - x) / 86400000);
  }
  function kacGunOnce(tarih, bugunIso) {
    var g = gunFarki(tarih, bugunIso);
    if (g === 0) return 'bugün';
    if (g === 1) return 'dün';
    if (g > 1) return g + ' gün önce';
    return (-g) + ' gün sonra';
  }

  function tutarHesapla(dersSayisi, birimUcret) {
    return yuvarla((Number(dersSayisi) || 0) * (Number(birimUcret) || 0));
  }

  function odendiMi(ders) { return !!ders.odeme && ders.odeme !== 'hayir'; }

  /** Öğrencinin bakiyesi. borc > 0 → borçlu, borc < 0 → avans. sonTarih verilirse o güne kadar (dahil). */
  function bakiye(ogrenciId, dersler, odemeler, sonTarih) {
    var toplamDers = 0, dersteAlinan = 0, sonradan = 0;
    for (var i = 0; i < dersler.length; i++) {
      var d = dersler[i];
      if (d.ogrenciId !== ogrenciId) continue;
      if (sonTarih && (d.tarih || '') > sonTarih) continue;
      toplamDers += Number(d.tutar) || 0;
      if (odendiMi(d)) dersteAlinan += Number(d.tutar) || 0;
    }
    for (var j = 0; j < odemeler.length; j++) {
      var o = odemeler[j];
      if (o.ogrenciId !== ogrenciId) continue;
      if (sonTarih && (o.tarih || '') > sonTarih) continue;
      sonradan += Number(o.tutar) || 0;
    }
    var borc = yuvarla(toplamDers - dersteAlinan - sonradan);
    return { toplamDers: yuvarla(toplamDers), dersteAlinan: yuvarla(dersteAlinan), sonradan: yuvarla(sonradan), borc: borc, avans: borc < 0 ? -borc : 0 };
  }

  /** Belirli bir ayın özeti. ay: 'yyyy-aa' */
  function ayOzeti(ay, dersler, odemeler) {
    var dersSayisi = 0, kazanilan = 0, tahsil = 0, ogrenciler = {};
    for (var i = 0; i < dersler.length; i++) {
      var d = dersler[i];
      if ((d.tarih || '').slice(0, 7) !== ay) continue;
      dersSayisi += Number(d.dersSayisi) || 0;
      kazanilan += Number(d.tutar) || 0;
      if (odendiMi(d)) tahsil += Number(d.tutar) || 0;
      ogrenciler[d.ogrenciId] = true;
    }
    for (var j = 0; j < odemeler.length; j++) {
      var o = odemeler[j];
      if ((o.tarih || '').slice(0, 7) === ay) tahsil += Number(o.tutar) || 0;
    }
    return { ay: ay, dersSayisi: yuvarla(dersSayisi), kazanilan: yuvarla(kazanilan), tahsil: yuvarla(tahsil), ogrenciSayisi: Object.keys(ogrenciler).length };
  }

  /** Eğitim yılı 1 Eylül'de başlar. */
  function egitimYili(isoTarih) {
    var y = parseInt(isoTarih.slice(0, 4), 10), m = parseInt(isoTarih.slice(5, 7), 10);
    var bas = m >= 9 ? y : y - 1;
    return { yil: bas, baslangic: bas + '-09-01', bitis: (bas + 1) + '-08-31', ad: bas + '–' + (bas + 1) };
  }

  function siralaAnahtar(k) { return (k.tarih || '') + '|' + (k.olusturma || ''); }

  /** Öğrencinin ders+ödeme geçmişi, en yeni üstte, her satırda o andaki bakiye */
  function gecmis(ogrenciId, dersler, odemeler) {
    var liste = [];
    dersler.forEach(function (d) { if (d.ogrenciId === ogrenciId) liste.push({ tip: 'ders', kayit: d }); });
    odemeler.forEach(function (o) { if (o.ogrenciId === ogrenciId) liste.push({ tip: 'odeme', kayit: o }); });
    liste.sort(function (a, b) { var x = siralaAnahtar(a.kayit), y = siralaAnahtar(b.kayit); return x < y ? -1 : x > y ? 1 : 0; });
    var b = 0;
    liste.forEach(function (s) {
      if (s.tip === 'ders') { b += Number(s.kayit.tutar) || 0; if (odendiMi(s.kayit)) b -= Number(s.kayit.tutar) || 0; }
      else b -= Number(s.kayit.tutar) || 0;
      s.bakiye = yuvarla(b);
    });
    return liste.reverse();
  }

  /** Öğrencinin en son dersi */
  function sonDers(ogrenciId, dersler) {
    var son = null;
    dersler.forEach(function (d) {
      if (d.ogrenciId !== ogrenciId) return;
      if (!son || siralaAnahtar(d) > siralaAnahtar(son)) son = d;
    });
    return son;
  }

  /** Verilen dersten hemen önceki ders (aynı öğrenci) */
  function oncekiDers(ders, dersler) {
    var k = siralaAnahtar(ders), son = null;
    dersler.forEach(function (d) {
      if (d.ogrenciId !== ders.ogrenciId || d.id === ders.id) return;
      if (siralaAnahtar(d) < k && (!son || siralaAnahtar(d) > siralaAnahtar(son))) son = d;
    });
    return son;
  }

  /** Borçlu öğrenciler, en borçlu üstte (pasifler de dahil) */
  function borclular(ogrenciler, dersler, odemeler) {
    var out = [];
    ogrenciler.forEach(function (o) {
      var b = bakiye(o.id, dersler, odemeler);
      if (b.borc > 0) out.push({ ogrenci: o, borc: b.borc });
    });
    out.sort(function (a, b) { return b.borc - a.borc; });
    return out;
  }

  function toplamlar(ogrenciler, dersler, odemeler) {
    var alacak = 0, avans = 0;
    ogrenciler.forEach(function (o) {
      var b = bakiye(o.id, dersler, odemeler);
      if (b.borc > 0) alacak += b.borc; else avans += -b.borc;
    });
    return { alacak: yuvarla(alacak), avans: yuvarla(avans) };
  }

  /** Nerede kaldık: aktif öğrenciler, en uzun süredir ders yapılmayan üstte, hiç dersi olmayan en altta */
  function neredeKaldik(ogrenciler, dersler, bugunIso) {
    var out = [];
    ogrenciler.forEach(function (o) {
      if (o.durum === 'pasif') return;
      var son = sonDers(o.id, dersler);
      out.push({ ogrenci: o, son: son, gun: son ? gunFarki(son.tarih, bugunIso) : null });
    });
    out.sort(function (a, b) {
      if (!a.son && !b.son) return (a.ogrenci.ad || '').localeCompare(b.ogrenci.ad || '', 'tr');
      if (!a.son) return 1;
      if (!b.son) return -1;
      return siralaAnahtar(a.son) < siralaAnahtar(b.son) ? -1 : 1;
    });
    return out;
  }

  /** Son işlemler: eklenen / düzenlenen / silinen kayıtlar, en yeni üstte */
  function sonIslemler(db, limit) {
    var out = [];
    [['ogrenci', db.ogrenciler], ['ders', db.dersler], ['odeme', db.odemeler], ['deneme', db.denemeler]].forEach(function (p) {
      (p[1] || []).forEach(function (k) {
        var z = k.guncelleme || k.olusturma || '';
        out.push({ zaman: z, tur: (k.olusturma && k.guncelleme && k.guncelleme > k.olusturma) ? 'duzenlendi' : 'eklendi', tip: p[0], kayit: k });
      });
    });
    (db.silinenler || []).forEach(function (s) { out.push({ zaman: s.silinmeZamani || '', tur: 'silindi', tip: s.tip, kayit: s.veri, silinen: s }); });
    out.sort(function (a, b) { return a.zaman < b.zaman ? 1 : a.zaman > b.zaman ? -1 : 0; });
    return out.slice(0, limit || 50);
  }

  /** Aylık döküm (veliye). ay: 'yyyy-aa' */
  function aylikDokum(ogrenciId, ay, dersler, odemeler) {
    var liste = dersler.filter(function (d) { return d.ogrenciId === ogrenciId && (d.tarih || '').slice(0, 7) === ay; })
      .sort(function (a, b) { return siralaAnahtar(a) < siralaAnahtar(b) ? -1 : 1; });
    var dersSayisi = 0, tutar = 0, odenen = 0;
    liste.forEach(function (d) { dersSayisi += Number(d.dersSayisi) || 0; tutar += Number(d.tutar) || 0; if (odendiMi(d)) odenen += Number(d.tutar) || 0; });
    odemeler.forEach(function (o) { if (o.ogrenciId === ogrenciId && (o.tarih || '').slice(0, 7) === ay) odenen += Number(o.tutar) || 0; });
    // ayın 1'inden önceki son gün: 'yyyy-aa-00' metin karşılaştırmasında ayın bütün günlerinden küçük, önceki ayın bütün günlerinden büyüktür
    var devreden = bakiye(ogrenciId, dersler, odemeler, ay + '-00').borc;
    return { dersler: liste, dersSayisi: yuvarla(dersSayisi), tutar: yuvarla(tutar), odenen: yuvarla(odenen), devreden: devreden, kalan: yuvarla(devreden + tutar - odenen) };
  }

  function dokumMetni(ogrenci, ay, dersler, odemeler) {
    var d = aylikDokum(ogrenci.id, ay, dersler, odemeler);
    var s = ['Merhaba, ' + ogrenci.ad + ' – ' + ayAdi(ay) + ' matematik dersleri:'];
    if (!d.dersler.length) s.push('Bu ay ders yapılmadı.');
    d.dersler.forEach(function (x) {
      s.push('• ' + formatTarih(x.tarih) + ' – ' + formatSayi(x.dersSayisi) + ' ders – ' + formatTL(x.tutar) + (x.konu ? ' – ' + x.konu : ''));
    });
    s.push('');
    s.push('Bu ay toplam: ' + formatSayi(d.dersSayisi) + ' ders, ' + formatTL(d.tutar));
    s.push('Bu ay ödenen: ' + formatTL(d.odenen));
    if (d.devreden > 0) s.push('Önceki aylardan devreden borç: ' + formatTL(d.devreden));
    if (d.devreden < 0) s.push('Önceki aylardan devreden peşin ödeme: ' + formatTL(-d.devreden));
    if (d.kalan > 0) s.push('*Kalan borç: ' + formatTL(d.kalan) + '*');
    else if (d.kalan < 0) s.push('*Peşin bakiye: ' + formatTL(-d.kalan) + '*');
    else s.push('*Borç bulunmuyor.*');
    s.push('');
    s.push('Teşekkürler, iyi günler.');
    return s.join('\n');
  }

  /** Ders sonrası bilgilendirme mesajı. alici: 'veli' | 'ogrenci' */
  function dersMesaji(ogrenci, ders, alici, onceki) {
    var s = [];
    if (alici === 'ogrenci') s.push('Merhaba ' + String(ogrenci.ad || '').split(' ')[0] + ', ' + formatTarih(ders.tarih) + ' tarihli dersimizin özeti:');
    else s.push('Merhaba, ' + ogrenci.ad + ' ile ' + formatTarih(ders.tarih) + ' tarihli matematik dersimizin özeti:');
    if (ders.konu) s.push('İşlenen konu: ' + ders.konu);
    if (alici !== 'ogrenci' && onceki && onceki.odev && onceki.odevDurum && ODEV_ETIKET[onceki.odevDurum])
      s.push('Önceki ödev (' + onceki.odev + '): ' + ODEV_ETIKET[onceki.odevDurum].toLocaleLowerCase('tr'));
    if (ders.kaldigimYer) s.push('Sonraki derste: ' + ders.kaldigimYer);
    if (ders.odev) s.push('Ödev: ' + ders.odev);
    s.push('İyi günler.');
    return s.join('\n');
  }

  function sayiVeyaBos(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /** Veride geçen eğitim yılları (başlangıç yılı), en yeni üstte; içinde bulunulan yıl her zaman var */
  function egitimYillari(db, bugunIso) {
    var set = {};
    set[egitimYili(bugunIso).yil] = true;
    [db.dersler, db.odemeler, db.denemeler].forEach(function (l) {
      (l || []).forEach(function (k) { if (k.tarih && k.tarih.length >= 7) set[egitimYili(k.tarih).yil] = true; });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }

  /** Bir eğitim yılının raporu */
  function rapor(yil, db, bugunIso) {
    var bas = yil + '-09-01', bit = (yil + 1) + '-08-31', buAy = bugunIso.slice(0, 7);
    var aylar = [], top = { dersSayisi: 0, kazanilan: 0, tahsil: 0 }, ogr = {};
    for (var i = 0; i < 12; i++) {
      var y = i < 4 ? yil : yil + 1, m = ((8 + i) % 12) + 1;
      var ay = y + '-' + pad(m);
      var o = ayOzeti(ay, db.dersler, db.odemeler);
      if (ay > buAy && !o.dersSayisi && !o.tahsil) continue;
      aylar.push(o);
      top.dersSayisi += o.dersSayisi; top.kazanilan += o.kazanilan; top.tahsil += o.tahsil;
    }
    var sinifMap = {}, ogrMap = {};
    db.ogrenciler.forEach(function (o) { ogrMap[o.id] = o; });
    db.dersler.forEach(function (d) {
      if (d.tarih < bas || d.tarih > bit) return;
      ogr[d.ogrenciId] = true;
      var sn = ogrMap[d.ogrenciId] ? (ogrMap[d.ogrenciId].sinif || 'Diğer') : 'Diğer';
      var e = sinifMap[sn] || (sinifMap[sn] = { sinif: sn, ogr: {}, dersSayisi: 0, kazanilan: 0 });
      e.ogr[d.ogrenciId] = true; e.dersSayisi += Number(d.dersSayisi) || 0; e.kazanilan += Number(d.tutar) || 0;
    });
    var siniflar = Object.keys(sinifMap).map(function (k) {
      var e = sinifMap[k];
      return { sinif: k, ogrenciSayisi: Object.keys(e.ogr).length, dersSayisi: yuvarla(e.dersSayisi), kazanilan: yuvarla(e.kazanilan) };
    }).sort(function (a, b) {
      var x = SINIFLAR.indexOf(a.sinif), z = SINIFLAR.indexOf(b.sinif);
      return (x < 0 ? 99 : x) - (z < 0 ? 99 : z);
    });
    var denMap = {};
    (db.denemeler || []).forEach(function (d) {
      if (d.tarih < bas || d.tarih > bit) return;
      (denMap[d.ogrenciId] || (denMap[d.ogrenciId] = [])).push(d);
    });
    var denemeler = Object.keys(denMap).map(function (id) {
      var l = denMap[id].slice().sort(function (a, b) { return siralaAnahtar(a) < siralaAnahtar(b) ? -1 : 1; });
      var netler = l.map(function (d) { return sayiVeyaBos(d.net); }).filter(function (n) { return n !== null; });
      var t = 0; netler.forEach(function (n) { t += n; });
      return { ogrenci: ogrMap[id] || { id: id, ad: '(silinmiş öğrenci)' }, adet: l.length,
        ilkNet: netler.length ? netler[0] : null, sonNet: netler.length ? netler[netler.length - 1] : null,
        ortNet: netler.length ? yuvarla(t / netler.length) : null };
    }).sort(function (a, b) { return (a.ogrenci.ad || '').localeCompare(b.ogrenci.ad || '', 'tr'); });
    return { yil: yil, ad: yil + '–' + (yil + 1), aylar: aylar,
      toplam: { dersSayisi: yuvarla(top.dersSayisi), kazanilan: yuvarla(top.kazanilan), tahsil: yuvarla(top.tahsil), ogrenciSayisi: Object.keys(ogr).length },
      siniflar: siniflar, denemeler: denemeler };
  }

  /** Excel yedeği için sayfalar: [{ad, genislik:[], satirlar:[[...]]}] — ilk satır başlık */
  function yedekSayfalari(db) {
    var ogrMap = {};
    db.ogrenciler.forEach(function (o) { ogrMap[o.id] = o; });
    function ad(id) { return ogrMap[id] ? ogrMap[id].ad : '(silinmiş öğrenci)'; }
    function sirali(l) { return l.slice().sort(function (a, b) { return siralaAnahtar(a) < siralaAnahtar(b) ? -1 : 1; }); }
    var s1 = [['Ad soyad', 'Sınıf', 'Ders başı ücret', 'Veli cep', 'Öğrenci cep', 'Durum', 'Toplam ders tutarı', 'Ödenen', 'Kalan borç (eksi = avans)', 'Not']];
    db.ogrenciler.slice().sort(function (a, b) { return (a.ad || '').localeCompare(b.ad || '', 'tr'); }).forEach(function (o) {
      var b = bakiye(o.id, db.dersler, db.odemeler);
      s1.push([o.ad, o.sinif, Number(o.ucret) || 0, o.veliTel || o.telefon || '', o.ogrenciTel || '', o.durum === 'pasif' ? 'Pasif' : 'Aktif', b.toplamDers, yuvarla(b.dersteAlinan + b.sonradan), b.borc, o.not || '']);
    });
    var s2 = [['Tarih', 'Öğrenci', 'Ders sayısı', 'Birim ücret', 'Tutar', 'Ödeme', 'İşlenen konu', 'Kaldığım yer', 'Ödev', 'Ödev durumu']];
    sirali(db.dersler).forEach(function (d) {
      s2.push([formatTarih(d.tarih), ad(d.ogrenciId), Number(d.dersSayisi) || 0, Number(d.birimUcret) || 0, Number(d.tutar) || 0, ODEME_ETIKET[d.odeme] || '', d.konu || '', d.kaldigimYer || '', d.odev || '', ODEV_ETIKET[d.odevDurum] || '']);
    });
    var s3 = [['Tarih', 'Öğrenci', 'Tutar', 'Yöntem', 'Not']];
    sirali(db.odemeler).forEach(function (o) { s3.push([formatTarih(o.tarih), ad(o.ogrenciId), Number(o.tutar) || 0, YONTEM_ETIKET[o.yontem] || '', o.not || '']); });
    var s4 = [['Tarih', 'Öğrenci', 'Sınav', 'Net', 'Puan', 'Not']];
    sirali(db.denemeler || []).forEach(function (d) {
      var n = sayiVeyaBos(d.net), p = sayiVeyaBos(d.puan);
      s4.push([formatTarih(d.tarih), ad(d.ogrenciId), d.ad || '', n === null ? '' : n, p === null ? '' : p, d.not || '']);
    });
    var aylar = {};
    db.dersler.concat(db.odemeler).forEach(function (k) { if (k.tarih && k.tarih.length >= 7) aylar[k.tarih.slice(0, 7)] = true; });
    var s5 = [['Ay', 'Ders sayısı', 'Öğrenci sayısı', 'Kazanılan', 'Tahsil edilen']];
    Object.keys(aylar).sort().forEach(function (a) { var o = ayOzeti(a, db.dersler, db.odemeler); s5.push([ayAdi(a), o.dersSayisi, o.ogrenciSayisi, o.kazanilan, o.tahsil]); });
    return [
      { ad: 'Öğrenciler', genislik: [26, 12, 14, 16, 16, 9, 16, 12, 22, 30], satirlar: s1 },
      { ad: 'Dersler', genislik: [12, 26, 10, 12, 12, 16, 34, 34, 30, 12], satirlar: s2 },
      { ad: 'Ödemeler', genislik: [12, 26, 12, 10, 30], satirlar: s3 },
      { ad: 'Denemeler', genislik: [12, 26, 26, 8, 8, 30], satirlar: s4 },
      { ad: 'Aylık özet', genislik: [16, 12, 14, 14, 14], satirlar: s5 }
    ];
  }

  /** Türk telefon numarasını WhatsApp için uluslararası biçime çevirir */
  function telefonUluslararasi(tel) {
    var r = String(tel || '').replace(/[^\d+]/g, '');
    if (!r) return '';
    if (r.charAt(0) === '+') return r.slice(1);
    if (r.indexOf('00') === 0) return r.slice(2);
    if (r.charAt(0) === '0' && r.length === 11) return '90' + r.slice(1);
    if (r.length === 10 && r.charAt(0) === '5') return '90' + r;
    return r;
  }

  function uid() {
    var t = Date.now().toString(36);
    var r = '';
    for (var i = 0; i < 8; i++) r += Math.floor(Math.random() * 36).toString(36);
    return t + '-' + r;
  }

  return {
    AYLAR: AYLAR, SINIFLAR: SINIFLAR, ODEME_ETIKET: ODEME_ETIKET, YONTEM_ETIKET: YONTEM_ETIKET, ODEV_ETIKET: ODEV_ETIKET, TIP_ETIKET: TIP_ETIKET,
    bugun: bugun, formatTarih: formatTarih, formatTL: formatTL, formatSayi: formatSayi, ayAdi: ayAdi, gunFarki: gunFarki, kacGunOnce: kacGunOnce,
    tutarHesapla: tutarHesapla, odendiMi: odendiMi, bakiye: bakiye, ayOzeti: ayOzeti, egitimYili: egitimYili, egitimYillari: egitimYillari,
    gecmis: gecmis, sonDers: sonDers, oncekiDers: oncekiDers, borclular: borclular, toplamlar: toplamlar, neredeKaldik: neredeKaldik,
    sonIslemler: sonIslemler, aylikDokum: aylikDokum, dokumMetni: dokumMetni, dersMesaji: dersMesaji, rapor: rapor, yedekSayfalari: yedekSayfalari,
    sayiVeyaBos: sayiVeyaBos, telefonUluslararasi: telefonUluslararasi, uid: uid, yuvarla: yuvarla, siralaAnahtar: siralaAnahtar
  };
});
