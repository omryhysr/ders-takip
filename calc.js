/* Ders Takip — hesap mantığı (tarayıcıda ve testte ortak) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hesap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var TZ = 'Europe/Istanbul';
  var AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var SINIFLAR = ['1. sınıf', '2. sınıf', '3. sınıf', '4. sınıf', '5. sınıf', '6. sınıf', '7. sınıf', '8. sınıf', '9. sınıf', '10. sınıf', '11. sınıf', '12. sınıf', 'Mezun', 'Üniversite', 'Diğer'];

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

  function formatTL(n) {
    n = yuvarla(n);
    var s;
    try {
      s = n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch (e) { s = String(n); }
    return s + ' ₺';
  }

  function ayAdi(iso) { // 'yyyy-aa' veya 'yyyy-aa-gg'
    var y = iso.slice(0, 4), m = parseInt(iso.slice(5, 7), 10);
    return AYLAR[m - 1] + ' ' + y;
  }

  function tutarHesapla(dersSayisi, birimUcret) {
    return yuvarla((Number(dersSayisi) || 0) * (Number(birimUcret) || 0));
  }

  function odendiMi(ders) { return !!ders.odeme && ders.odeme !== 'hayir'; }

  /** Öğrencinin bakiyesi. borc > 0 → borçlu, borc < 0 → avans (peşin ödemiş) */
  function bakiye(ogrenciId, dersler, odemeler) {
    var toplamDers = 0, dersteAlinan = 0, sonradan = 0;
    for (var i = 0; i < dersler.length; i++) {
      var d = dersler[i];
      if (d.ogrenciId !== ogrenciId) continue;
      toplamDers += Number(d.tutar) || 0;
      if (odendiMi(d)) dersteAlinan += Number(d.tutar) || 0;
    }
    for (var j = 0; j < odemeler.length; j++) {
      var o = odemeler[j];
      if (o.ogrenciId === ogrenciId) sonradan += Number(o.tutar) || 0;
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

  /** Eğitim yılı 1 Eylül'de başlar. '2026-03-10' → { baslangic:'2025-09-01', bitis:'2026-08-31', ad:'2025–2026' } */
  function egitimYili(isoTarih) {
    var y = parseInt(isoTarih.slice(0, 4), 10), m = parseInt(isoTarih.slice(5, 7), 10);
    var bas = m >= 9 ? y : y - 1;
    return { baslangic: bas + '-09-01', bitis: (bas + 1) + '-08-31', ad: bas + '–' + (bas + 1) };
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

  /** Öğrencinin en son dersi (tarih + oluşturma sırasına göre) */
  function sonDers(ogrenciId, dersler) {
    var son = null;
    dersler.forEach(function (d) {
      if (d.ogrenciId !== ogrenciId) return;
      if (!son || siralaAnahtar(d) > siralaAnahtar(son)) son = d;
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
    AYLAR: AYLAR, SINIFLAR: SINIFLAR, bugun: bugun, formatTarih: formatTarih, formatTL: formatTL, ayAdi: ayAdi,
    tutarHesapla: tutarHesapla, odendiMi: odendiMi, bakiye: bakiye, ayOzeti: ayOzeti, egitimYili: egitimYili,
    gecmis: gecmis, sonDers: sonDers, borclular: borclular, toplamlar: toplamlar, telefonUluslararasi: telefonUluslararasi,
    uid: uid, yuvarla: yuvarla
  };
});
