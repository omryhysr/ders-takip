/* Ders Takip — uygulama */
(function () {
  'use strict';
  var H = window.Hesap;
  var SURUM = '1.0.0';

  /* ---------------- Depolama ---------------- */
  var K = { db: 'dt_db', outbox: 'dt_outbox', ayar: 'dt_ayar' };
  function oku(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Depolama hatası', e); } }

  var db = oku(K.db) || { ogrenciler: [], dersler: [], odemeler: [], sonSenk: null };
  var outbox = oku(K.outbox) || [];
  var ayar = oku(K.ayar) || { url: '', key: '' };
  function kalici() { yaz(K.db, db); yaz(K.outbox, outbox); }

  var LISTE = { ogrenci: 'ogrenciler', ders: 'dersler', odeme: 'odemeler' };

  function uygulaYerel(op) {
    var liste = db[LISTE[op.tip]];
    var i = liste.findIndex(function (k) { return k.id === (op.kayit ? op.kayit.id : op.id); });
    if (op.islem === 'kaydet') { if (i >= 0) liste[i] = op.kayit; else liste.push(op.kayit); }
    else if (op.islem === 'sil') { if (i >= 0) liste.splice(i, 1); }
  }

  /* ---------------- Sunucu ---------------- */
  function bekle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function istek(govde, zamanAsimi) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, zamanAsimi || 25000);
    govde.key = ayar.key;
    return fetch(ayar.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(govde),
      signal: ctrl ? ctrl.signal : undefined,
      redirect: 'follow'
    }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('Sunucu yanıtı: ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.ok) { var e = new Error(j.hata || 'Sunucu hatası'); e.sunucu = true; e.yetkisiz = j.hata === 'yetkisiz'; throw e; }
      return j.sonuc;
    }, function (e) { clearTimeout(t); throw e; });
  }

  function istekTekrarli(govde) {
    var denemeler = [0, 1500, 4000];
    var i = 0;
    function dene() {
      return istek(govde).catch(function (e) {
        if (e.yetkisiz || e.sunucu || i >= denemeler.length - 1) throw e;
        i++;
        return bekle(denemeler[i]).then(dene);
      });
    }
    return dene();
  }

  var senkDurum = 'bos', tekrarIste = false, sonHata = '';

  function senk() {
    if (!ayar.url || !ayar.key) return Promise.resolve({ ok: false, neden: 'ayar' });
    if (senkDurum === 'calisiyor') { tekrarIste = true; return Promise.resolve({ ok: false, neden: 'mesgul' }); }
    senkDurum = 'calisiyor'; durumCiz();
    var gonderilen = outbox.slice();
    var govde = gonderilen.length
      ? { islem: 'toplu', islemler: gonderilen.map(function (o) { return { islem: o.islem, tip: o.tip, kayit: o.kayit, id: o.id }; }) }
      : { islem: 'hepsi' };
    return istekTekrarli(govde).then(function (sonuc) {
      var veri = gonderilen.length ? sonuc.veri : sonuc;
      var gidenler = {};
      gonderilen.forEach(function (o) { gidenler[o.opId] = true; });
      outbox = outbox.filter(function (o) { return !gidenler[o.opId]; });
      db = { ogrenciler: veri.ogrenciler || [], dersler: veri.dersler || [], odemeler: veri.odemeler || [], sonSenk: Date.now() };
      outbox.forEach(uygulaYerel);
      kalici();
      sonHata = '';
      return { ok: true };
    }).catch(function (e) {
      sonHata = e.yetkisiz ? 'Gizli anahtar yanlış' : (e.message || 'Bağlantı hatası');
      return { ok: false, neden: e.yetkisiz ? 'yetkisiz' : 'ag', mesaj: sonHata };
    }).then(function (r) {
      senkDurum = 'bos';
      ciz();
      if (tekrarIste) { tekrarIste = false; senk(); }
      return r;
    });
  }

  function kaydetKayit(tip, kayit) {
    var simdi = new Date().toISOString();
    if (!kayit.olusturma) kayit.olusturma = simdi;
    kayit.guncelleme = simdi;
    var op = { opId: H.uid(), islem: 'kaydet', tip: tip, kayit: kayit };
    uygulaYerel(op); outbox.push(op); kalici();
    return senk().then(sonucBildir);
  }

  function silKayit(tip, id) {
    var op = { opId: H.uid(), islem: 'sil', tip: tip, id: id };
    uygulaYerel(op); outbox.push(op); kalici();
    return senk().then(sonucBildir);
  }

  function sonucBildir(r) {
    if (r.ok) bildir('Kaydedildi ✓', 'basari');
    else if (r.neden === 'ayar') bildir('Telefona kaydedildi. Ayarlar ekranından bağlantıyı kurun.', 'uyari');
    else if (r.neden === 'yetkisiz') bildir('Telefona kaydedildi ama gizli anahtar yanlış. Ayarlar\'ı kontrol edin.', 'hata');
    else if (r.neden === 'mesgul') bildir('Kaydedildi, gönderiliyor…', 'basari');
    else if (!navigator.onLine) bildir('Telefona kaydedildi ✓ İnternet gelince gönderilecek.', 'uyari');
    else bildir('Kaydedilemedi, tekrar denenecek (' + r.mesaj + ')', 'hata');
    return r;
  }

  /* ---------------- Bildirim ---------------- */
  var bildirimZamanlayici;
  function bildir(metin, tur) {
    var b = document.getElementById('bildirim');
    b.textContent = metin; b.className = tur || ''; b.hidden = false;
    clearTimeout(bildirimZamanlayici);
    bildirimZamanlayici = setTimeout(function () { b.hidden = true; }, tur === 'hata' ? 5000 : 2500);
  }

  /* ---------------- Yardımcılar ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ogrenciBul(id) { return db.ogrenciler.find(function (o) { return o.id === id; }); }
  function aktifOgrenciler() { return db.ogrenciler.filter(function (o) { return o.durum !== 'pasif'; }).sort(adSirala); }
  function adSirala(a, b) { return (a.ad || '').localeCompare(b.ad || '', 'tr'); }
  function bakiyeHtml(borc, kisa) {
    if (borc > 0) return '<span class="borc">' + (kisa ? '' : 'Borç: ') + H.formatTL(borc) + '</span>';
    if (borc < 0) return '<span class="avans">' + (kisa ? '' : 'Avans: ') + H.formatTL(-borc) + '</span>';
    return '<span class="sifir">' + (kisa ? '0 ₺' : 'Borcu yok') + '</span>';
  }
  function odemeRozet(d) {
    if (d.odeme === 'nakit') return '<span class="rozet nakit">Nakit alındı</span>';
    if (d.odeme === 'havale') return '<span class="rozet havale">Havale alındı</span>';
    return '<span class="rozet odenmedi">Ödenmedi</span>';
  }
  function ogrenciSecenekleri(secili, pasifDahil) {
    var liste = pasifDahil ? db.ogrenciler.slice().sort(adSirala) : aktifOgrenciler();
    var sec = secili ? ogrenciBul(secili) : null;
    if (sec && liste.indexOf(sec) < 0) liste.push(sec);
    return '<option value="">Öğrenci seçin…</option>' + liste.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === secili ? ' selected' : '') + '>' + esc(o.ad) + (o.durum === 'pasif' ? ' (pasif)' : '') + '</option>';
    }).join('');
  }
  function sinifSecenekleri(secili) {
    return H.SINIFLAR.map(function (s) { return '<option' + (s === secili ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
  }
  function sayi(v) { var n = Number(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }

  /* ---------------- Yönlendirme ---------------- */
  function rota() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var soru = h.indexOf('?');
    if (soru >= 0) {
      h.slice(soru + 1).split('&').forEach(function (p) { var kv = p.split('='); q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
      h = h.slice(0, soru);
    }
    return { parca: h.split('/').filter(Boolean), q: q };
  }

  function baslikCiz(metin, geri) {
    document.getElementById('baslik').innerHTML =
      (geri ? '<a class="geri" href="' + esc(geri) + '" aria-label="Geri">‹</a>' : '') +
      '<h1>' + esc(metin) + '</h1><span class="durum" id="durum"></span>';
    durumCiz();
  }

  function durumCiz() {
    var d = document.getElementById('durum');
    if (!d) return;
    d.className = 'durum';
    if (!ayar.url || !ayar.key) { d.textContent = 'Bağlantı kurulmadı'; d.className += ' bekliyor'; return; }
    if (senkDurum === 'calisiyor') { d.textContent = 'Gönderiliyor…'; return; }
    if (outbox.length) { d.textContent = outbox.length + ' kayıt bekliyor'; d.className += ' bekliyor'; return; }
    if (sonHata) { d.textContent = 'Bağlantı yok'; d.className += ' hata'; return; }
    if (db.sonSenk) { var t = new Date(db.sonSenk); d.textContent = '✓ ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); return; }
    d.textContent = '';
  }

  function ciz() {
    var r = rota();
    var p = r.parca;
    var icerik = document.getElementById('icerik');
    var nav = 'ana';
    try {
      if (p.length === 0) { ekranAna(icerik); }
      else if (p[0] === 'ogrenciler') { nav = 'ogrenciler'; ekranOgrenciler(icerik, r.q); }
      else if (p[0] === 'ogrenci' && p[1] === 'yeni') { nav = 'ogrenciler'; ekranOgrenciFormu(icerik, null); }
      else if (p[0] === 'ogrenci' && p[2] === 'duzenle') { nav = 'ogrenciler'; ekranOgrenciFormu(icerik, p[1]); }
      else if (p[0] === 'ogrenci' && p[1]) { nav = 'ogrenciler'; ekranOgrenciKarti(icerik, p[1]); }
      else if (p[0] === 'ders') { nav = 'ders'; ekranDersFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'odeme') { nav = 'odeme'; ekranOdemeFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'ayarlar') { nav = 'ayarlar'; ekranAyarlar(icerik); }
      else { location.hash = '#/'; return; }
    } catch (e) {
      console.error(e);
      icerik.innerHTML = '<div class="kart"><b>Bir hata oluştu:</b> ' + esc(e.message) + '</div>';
    }
    document.querySelectorAll('#alt-menu a').forEach(function (a) { a.classList.toggle('aktif', a.getAttribute('data-nav') === nav); });
    window.scrollTo(0, 0);
  }

  /* ---------------- Ekran 1: Ana sayfa ---------------- */
  function ekranAna(el) {
    baslikCiz('Ders Takip');
    var ay = H.bugun().slice(0, 7);
    var o = H.ayOzeti(ay, db.dersler, db.odemeler);
    var t = H.toplamlar(db.ogrenciler, db.dersler, db.odemeler);
    var borclular = H.borclular(db.ogrenciler, db.dersler, db.odemeler);
    var html = '';
    if (!ayar.url || !ayar.key) {
      html += '<div class="ipucu"><b>Bağlantı kurulmadı.</b> Girdiğiniz kayıtlar şimdilik yalnızca bu telefonda saklanır. <a href="#/ayarlar">Ayarlar</a> ekranından web uygulaması adresini ve gizli anahtarı girin.</div>';
    }
    html += '<div class="buyuk-butonlar"><a class="buton" href="#/ders/yeni">+ Ders</a><a class="buton yesil" href="#/odeme/yeni">+ Ödeme</a></div>';
    html += '<div class="kart"><h2>' + esc(H.ayAdi(ay)) + '</h2><div class="ozet">' +
      '<div><div class="deger">' + o.dersSayisi + '</div><div class="etiket">ders</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.kazanilan)) + '</div><div class="etiket">kazanılan</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.tahsil)) + '</div><div class="etiket">tahsil edilen</div></div></div></div>';
    html += '<div class="kart"><div class="ozet" style="grid-template-columns:1fr 1fr">' +
      '<div><div class="deger borc">' + esc(H.formatTL(t.alacak)) + '</div><div class="etiket">toplam alacak</div></div>' +
      '<div><div class="deger avans">' + esc(H.formatTL(t.avans)) + '</div><div class="etiket">toplam avans</div></div></div></div>';
    html += '<div class="kart"><h2>Borçlu öğrenciler</h2>';
    if (!borclular.length) html += '<div class="bos">Borçlu öğrenci yok 🎉</div>';
    borclular.forEach(function (b) {
      html += '<a class="satir" href="#/ogrenci/' + esc(b.ogrenci.id) + '"><div class="sol"><div class="ad">' + esc(b.ogrenci.ad) +
        (b.ogrenci.durum === 'pasif' ? ' <span class="rozet pasif">pasif</span>' : '') + '</div><div class="alt">' + esc(b.ogrenci.sinif) + '</div></div>' +
        '<div class="sag">' + bakiyeHtml(b.borc, true) + '</div></a>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  /* ---------------- Ekran 2: Öğrenciler ---------------- */
  var ogrAra = '', pasifGoster = false;
  function ekranOgrenciler(el, q) {
    baslikCiz('Öğrenciler');
    var liste = db.ogrenciler.slice().sort(adSirala);
    var html = '<input class="arama" type="text" id="ara" placeholder="Ara…" value="' + esc(ogrAra) + '" autocomplete="off">' +
      '<div class="kontrol"><label><input type="checkbox" id="pasifGoster"' + (pasifGoster ? ' checked' : '') + '> Pasifleri göster</label>' +
      '<a class="buton kucuk" href="#/ogrenci/yeni">+ Öğrenci</a></div><div class="kart" id="ogrListe"></div>';
    el.innerHTML = html;
    function listele() {
      var ara = ogrAra.toLocaleLowerCase('tr');
      var f = liste.filter(function (o) { return (pasifGoster || o.durum !== 'pasif') && (!ara || (o.ad || '').toLocaleLowerCase('tr').indexOf(ara) >= 0); });
      var h = '';
      if (!f.length) h = '<div class="bos">' + (liste.length ? 'Eşleşen öğrenci yok' : 'Henüz öğrenci yok. "+ Öğrenci" ile ekleyin.') + '</div>';
      f.forEach(function (o) {
        var b = H.bakiye(o.id, db.dersler, db.odemeler);
        h += '<a class="satir" href="#/ogrenci/' + esc(o.id) + '"><div class="sol"><div class="ad">' + esc(o.ad) +
          (o.durum === 'pasif' ? ' <span class="rozet pasif">pasif</span>' : '') + '</div><div class="alt">' + esc(o.sinif) + ' · ' + esc(H.formatTL(o.ucret)) + '/ders</div></div>' +
          '<div class="sag">' + bakiyeHtml(b.borc, true) + '</div></a>';
      });
      document.getElementById('ogrListe').innerHTML = h;
    }
    listele();
    document.getElementById('ara').addEventListener('input', function (e) { ogrAra = e.target.value; listele(); });
    document.getElementById('pasifGoster').addEventListener('change', function (e) { pasifGoster = e.target.checked; listele(); });
  }

  /* ---------------- Ekran 3: Öğrenci kartı ---------------- */
  function ekranOgrenciKarti(el, id) {
    var o = ogrenciBul(id);
    if (!o) { baslikCiz('Öğrenci', '#/ogrenciler'); el.innerHTML = '<div class="bos">Öğrenci bulunamadı.</div>'; return; }
    baslikCiz(o.ad, '#/ogrenciler');
    var b = H.bakiye(o.id, db.dersler, db.odemeler);
    var son = H.sonDers(o.id, db.dersler);
    var tel = H.telefonUluslararasi(o.telefon);
    var html = '<div class="kart"><div class="bakiye-buyuk">' + bakiyeHtml(b.borc) + '</div>' +
      '<div class="ortala bilgi">' + esc(o.sinif) + ' · ' + esc(H.formatTL(o.ucret)) + '/ders' + (o.durum === 'pasif' ? ' · <span class="rozet pasif">pasif</span>' : '') + '</div>';
    if (o.telefon) html += '<div class="tel-butonlar"><a class="buton ikincil kucuk" href="tel:' + esc(o.telefon.replace(/\s/g, '')) + '">📞 Ara</a>' +
      '<a class="buton yesil kucuk" href="https://wa.me/' + esc(tel) + '" target="_blank" rel="noopener">💬 WhatsApp</a></div>';
    if (o.not) html += '<div class="bilgi">' + esc(o.not) + '</div>';
    if (son && son.kaldigimYer) html += '<div class="ipucu"><b>Sonraki derste:</b> ' + esc(son.kaldigimYer) + '</div>';
    html += '<div class="buton-sira"><a class="buton" href="#/ders/yeni?ogr=' + esc(o.id) + '">+ Ders</a><a class="buton yesil" href="#/odeme/yeni?ogr=' + esc(o.id) + '">+ Ödeme</a></div>' +
      '<div class="buton-sira"><a class="buton ikincil kucuk" href="#/ogrenci/' + esc(o.id) + '/duzenle">Düzenle</a>' +
      '<button class="buton ikincil kucuk" id="durumDegistir">' + (o.durum === 'pasif' ? 'Aktif yap' : 'Pasif yap') + '</button></div></div>';

    var g = H.gecmis(o.id, db.dersler, db.odemeler);
    html += '<div class="kart"><h2>Geçmiş</h2>';
    if (!g.length) html += '<div class="bos">Henüz kayıt yok.</div>';
    g.forEach(function (s) {
      var k = s.kayit;
      if (s.tip === 'ders') {
        html += '<a class="satir" href="#/ders/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · Ders' + (sayi(k.dersSayisi) !== 1 ? ' ×' + esc(k.dersSayisi) : '') + ' · ' + esc(H.formatTL(k.tutar)) + ' ' + odemeRozet(k) + '</div>' +
          '<div class="alt sarili">' + esc(k.konu || '') + (k.kaldigimYer ? ' → ' + esc(k.kaldigimYer) : '') + '</div></div>' +
          '<div class="sag">' + bakiyeHtml(s.bakiye, true) + '</div></a>';
      } else {
        html += '<a class="satir" href="#/odeme/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · Ödeme ' + esc(H.formatTL(k.tutar)) + ' <span class="rozet ' + esc(k.yontem) + '">' + (k.yontem === 'havale' ? 'Havale' : 'Nakit') + '</span></div>' +
          (k.not ? '<div class="alt sarili">' + esc(k.not) + '</div>' : '') + '</div><div class="sag">' + bakiyeHtml(s.bakiye, true) + '</div></a>';
      }
    });
    html += '</div>';
    el.innerHTML = html;
    document.getElementById('durumDegistir').addEventListener('click', function () {
      var yeni = Object.assign({}, o, { durum: o.durum === 'pasif' ? 'aktif' : 'pasif' });
      kaydetKayit('ogrenci', yeni).then(ciz);
    });
  }

  /* ---------------- Öğrenci formu ---------------- */
  function ekranOgrenciFormu(el, id) {
    var o = id ? ogrenciBul(id) : null;
    if (id && !o) { location.hash = '#/ogrenciler'; return; }
    baslikCiz(o ? 'Öğrenciyi düzenle' : 'Yeni öğrenci', o ? '#/ogrenci/' + o.id : '#/ogrenciler');
    var yeniId = o ? o.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Ad soyad *</span><input type="text" name="ad" required value="' + esc(o ? o.ad : '') + '" autocomplete="off"></label>' +
      '<label class="alan"><span>Sınıf</span><select name="sinif">' + sinifSecenekleri(o ? o.sinif : '') + '</select></label>' +
      '<label class="alan"><span>Ders başı ücret (₺) *</span><input type="number" name="ucret" inputmode="decimal" step="any" min="0" required value="' + esc(o ? o.ucret : '') + '"></label>' +
      (o ? '<div class="bilgi">Ücreti değiştirmek yalnızca bundan sonra girilen dersleri etkiler; eski dersler değişmez.</div>' : '') +
      '<label class="alan"><span>Veli / öğrenci telefonu</span><input type="tel" name="telefon" value="' + esc(o ? o.telefon : '') + '" placeholder="05xx xxx xx xx"></label>' +
      '<label class="alan"><span>Not</span><textarea name="not">' + esc(o ? o.not : '') + '</textarea></label>' +
      '<div class="alan-baslik">Durum</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="durum" value="aktif"' + (!o || o.durum !== 'pasif' ? ' checked' : '') + '><span>Aktif</span></label>' +
      '<label><input type="radio" name="durum" value="pasif"' + (o && o.durum === 'pasif' ? ' checked' : '') + '><span>Pasif</span></label></div>' +
      '<button class="buton" type="submit" id="kaydet">Kaydet</button>' +
      (o ? '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Öğrenciyi sil</button>' : '') +
      '</form>';
    var f = document.getElementById('f');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f);
      var kayit = Object.assign({}, o || {}, {
        id: yeniId, ad: fd.get('ad').trim(), sinif: fd.get('sinif'), ucret: sayi(fd.get('ucret')),
        telefon: fd.get('telefon').trim(), not: fd.get('not').trim(), durum: fd.get('durum')
      });
      kaydetKayit('ogrenci', kayit);
      location.hash = '#/ogrenci/' + yeniId;
    });
    if (o) document.getElementById('sil').addEventListener('click', function () {
      var dersSayisi = db.dersler.filter(function (d) { return d.ogrenciId === o.id; }).length;
      var odemeSayisi = db.odemeler.filter(function (d) { return d.ogrenciId === o.id; }).length;
      var mesaj = '"' + o.ad + '" silinsin mi?' + (dersSayisi || odemeSayisi ? '\n\nÖğrencinin ' + dersSayisi + ' ders ve ' + odemeSayisi + ' ödeme kaydı da silinecek.' : '') +
        '\n\nBırakan öğrenciyi silmek yerine "Pasif yap" seçeneğini kullanmanız önerilir.';
      if (!confirm(mesaj)) return;
      db.dersler.filter(function (d) { return d.ogrenciId === o.id; }).forEach(function (d) {
        var op = { opId: H.uid(), islem: 'sil', tip: 'ders', id: d.id }; uygulaYerel(op); outbox.push(op);
      });
      db.odemeler.filter(function (d) { return d.ogrenciId === o.id; }).forEach(function (d) {
        var op = { opId: H.uid(), islem: 'sil', tip: 'odeme', id: d.id }; uygulaYerel(op); outbox.push(op);
      });
      kalici();
      silKayit('ogrenci', o.id);
      location.hash = '#/ogrenciler';
    });
  }

  /* ---------------- Ekran 4: Ders formu ---------------- */
  function ekranDersFormu(el, id, q) {
    var d = id ? db.dersler.find(function (x) { return x.id === id; }) : null;
    if (id && !d) { location.hash = '#/'; return; }
    var ogrId = d ? d.ogrenciId : (q.ogr || '');
    baslikCiz(d ? 'Dersi düzenle' : 'Ders ekle', d ? '#/ogrenci/' + d.ogrenciId : (ogrId ? '#/ogrenci/' + ogrId : '#/'));
    if (!db.ogrenciler.length) { el.innerHTML = '<div class="kart bos">Önce bir öğrenci ekleyin.<br><br><a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a></div>'; return; }
    var yeniId = d ? d.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" id="ogr" required>' + ogrenciSecenekleri(ogrId, !!d) + '</select></label>' +
      '<div id="oncekiYer"></div>' +
      '<div class="alan-baslik">Ücreti aldım mı? *</div><div class="secenekler" style="margin-bottom:14px">' +
      ['hayir|Hayır', 'nakit|Evet · Nakit', 'havale|Evet · Havale'].map(function (s) {
        var p = s.split('|');
        return '<label><input type="radio" name="odeme" value="' + p[0] + '" required' + (d && d.odeme === p[0] ? ' checked' : '') + '><span>' + p[1] + '</span></label>';
      }).join('') + '</div>' +
      '<label class="alan"><span>İşlenen konu</span><input type="text" name="konu" value="' + esc(d ? d.konu : '') + '" autocomplete="off"></label>' +
      '<label class="alan"><span>Kaldığım yer / sonraki derste</span><input type="text" name="kaldigimYer" value="' + esc(d ? d.kaldigimYer : '') + '" autocomplete="off"></label>' +
      '<label class="alan"><span>Ödev / not</span><textarea name="odev">' + esc(d ? d.odev : '') + '</textarea></label>' +
      '<details' + (d ? ' open' : '') + '><summary>Tarih, ders sayısı, ücret</summary>' +
      '<label class="alan"><span>Tarih</span><input type="date" name="tarih" required value="' + esc(d ? d.tarih : H.bugun()) + '"></label>' +
      '<label class="alan"><span>Ders sayısı</span><input type="number" name="dersSayisi" id="dersSayisi" inputmode="decimal" step="any" min="0" required value="' + esc(d ? d.dersSayisi : 1) + '"></label>' +
      '<label class="alan"><span>Birim ücret (₺)</span><input type="number" name="birimUcret" id="birimUcret" inputmode="decimal" step="any" min="0" required value="' + esc(d ? d.birimUcret : '') + '"></label>' +
      '<div class="bilgi">Tutar: <b id="tutar">—</b></div></details>' +
      '<button class="buton" type="submit" id="kaydet" style="margin-top:10px">Kaydet</button>' +
      (d ? '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Dersi sil</button>' : '') +
      '</form>';
    var f = document.getElementById('f');
    var secim = document.getElementById('ogr'), birim = document.getElementById('birimUcret'), adet = document.getElementById('dersSayisi');
    var birimElleDegisti = !!d;
    function tutarYaz() { document.getElementById('tutar').textContent = H.formatTL(H.tutarHesapla(adet.value, birim.value)); }
    function ogrenciDegisti() {
      var o = ogrenciBul(secim.value);
      if (o && !birimElleDegisti) birim.value = o.ucret;
      var son = o ? H.sonDers(o.id, db.dersler.filter(function (x) { return !d || x.id !== d.id; })) : null;
      document.getElementById('oncekiYer').innerHTML = son
        ? '<div class="ipucu"><b>Önceki ders (' + esc(H.formatTarih(son.tarih)) + '):</b> ' + esc(son.kaldigimYer || son.konu || '—') + '</div>'
        : (o ? '<div class="bilgi">Bu öğrencinin ilk dersi.</div>' : '');
      tutarYaz();
    }
    secim.addEventListener('change', ogrenciDegisti);
    birim.addEventListener('input', function () { birimElleDegisti = true; tutarYaz(); });
    adet.addEventListener('input', tutarYaz);
    ogrenciDegisti();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f);
      var ds = sayi(fd.get('dersSayisi')), bu = sayi(fd.get('birimUcret'));
      var kayit = Object.assign({}, d || {}, {
        id: yeniId, tarih: fd.get('tarih'), ogrenciId: fd.get('ogrenciId'), dersSayisi: ds, birimUcret: bu, tutar: H.tutarHesapla(ds, bu),
        odeme: fd.get('odeme'), konu: fd.get('konu').trim(), kaldigimYer: fd.get('kaldigimYer').trim(), odev: fd.get('odev').trim()
      });
      kaydetKayit('ders', kayit);
      location.hash = '#/ogrenci/' + kayit.ogrenciId;
    });
    if (d) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu ders kaydı silinsin mi?\n' + H.formatTarih(d.tarih) + ' · ' + H.formatTL(d.tutar))) return;
      silKayit('ders', d.id);
      location.hash = '#/ogrenci/' + d.ogrenciId;
    });
  }

  /* ---------------- Ekran 5: Ödeme formu ---------------- */
  function ekranOdemeFormu(el, id, q) {
    var p = id ? db.odemeler.find(function (x) { return x.id === id; }) : null;
    if (id && !p) { location.hash = '#/'; return; }
    var ogrId = p ? p.ogrenciId : (q.ogr || '');
    baslikCiz(p ? 'Ödemeyi düzenle' : 'Ödeme ekle', p ? '#/ogrenci/' + p.ogrenciId : (ogrId ? '#/ogrenci/' + ogrId : '#/'));
    if (!db.ogrenciler.length) { el.innerHTML = '<div class="kart bos">Önce bir öğrenci ekleyin.<br><br><a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a></div>'; return; }
    var yeniId = p ? p.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" id="ogr" required>' + ogrenciSecenekleri(ogrId, true) + '</select></label>' +
      '<div id="borcBilgi"></div>' +
      '<label class="alan"><span>Tutar (₺) *</span><input type="number" name="tutar" id="tutar" inputmode="decimal" step="any" min="0.01" required value="' + esc(p ? p.tutar : '') + '"></label>' +
      '<div class="alan-baslik">Nasıl alındı? *</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="yontem" value="nakit" required' + (!p || p.yontem === 'nakit' ? ' checked' : '') + '><span>Nakit</span></label>' +
      '<label><input type="radio" name="yontem" value="havale"' + (p && p.yontem === 'havale' ? ' checked' : '') + '><span>Havale / EFT</span></label></div>' +
      '<label class="alan"><span>Tarih</span><input type="date" name="tarih" required value="' + esc(p ? p.tarih : H.bugun()) + '"></label>' +
      '<label class="alan"><span>Not</span><input type="text" name="not" value="' + esc(p ? p.not : '') + '" autocomplete="off"></label>' +
      '<button class="buton yesil" type="submit" id="kaydet">Kaydet</button>' +
      (p ? '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Ödemeyi sil</button>' : '') +
      '</form>';
    var f = document.getElementById('f');
    var secim = document.getElementById('ogr');
    function borcGoster() {
      var o = ogrenciBul(secim.value);
      var el2 = document.getElementById('borcBilgi');
      if (!o) { el2.innerHTML = ''; return; }
      var b = H.bakiye(o.id, db.dersler, db.odemeler.filter(function (x) { return !p || x.id !== p.id; }));
      el2.innerHTML = '<div class="ipucu">Şu anki durum: ' + bakiyeHtml(b.borc) + '</div>';
      if (!p && b.borc > 0 && !document.getElementById('tutar').value) document.getElementById('tutar').placeholder = String(b.borc);
    }
    secim.addEventListener('change', borcGoster);
    borcGoster();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f);
      var kayit = Object.assign({}, p || {}, {
        id: yeniId, tarih: fd.get('tarih'), ogrenciId: fd.get('ogrenciId'), tutar: sayi(fd.get('tutar')), yontem: fd.get('yontem'), not: fd.get('not').trim()
      });
      kaydetKayit('odeme', kayit);
      location.hash = '#/ogrenci/' + kayit.ogrenciId;
    });
    if (p) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu ödeme kaydı silinsin mi?\n' + H.formatTarih(p.tarih) + ' · ' + H.formatTL(p.tutar))) return;
      silKayit('odeme', p.id);
      location.hash = '#/ogrenci/' + p.ogrenciId;
    });
  }

  /* ---------------- Ayarlar ---------------- */
  function ekranAyarlar(el) {
    baslikCiz('Ayarlar');
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Web uygulaması adresi (Apps Script)</span><input type="url" name="url" value="' + esc(ayar.url) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label class="alan"><span>Gizli anahtar (e-tablodaki "Ayarlar" sayfasından)</span><input type="password" name="key" value="' + esc(ayar.key) + '" autocomplete="off"></label>' +
      '<button class="buton" type="submit" id="kaydet">Kaydet ve bağlantıyı test et</button></form>' +
      '<div class="kart"><h2>Durum</h2><div class="bilgi">Bekleyen kayıt: <b>' + outbox.length + '</b>' +
      (db.sonSenk ? '<br>Son eşitleme: ' + esc(new Date(db.sonSenk).toLocaleString('tr-TR')) : '') +
      (sonHata ? '<br>Son hata: <span class="borc">' + esc(sonHata) + '</span>' : '') +
      '<br>Öğrenci: ' + db.ogrenciler.length + ' · Ders: ' + db.dersler.length + ' · Ödeme: ' + db.odemeler.length + '</div>' +
      '<button class="buton ikincil" id="senk">Şimdi eşitle</button></div>' +
      '<div class="kart"><h2>Ana ekrana ekleme</h2><div class="bilgi"><b>Android (Chrome):</b> sağ üst ⋮ menü → "Ana ekrana ekle" / "Uygulamayı yükle".<br><b>iPhone (Safari):</b> alttaki Paylaş düğmesi → "Ana Ekrana Ekle".</div></div>' +
      '<div class="kart"><h2>Tehlikeli bölge</h2><div class="bilgi">Bu telefondaki kopyayı siler ve sunucudan yeniden indirir. Henüz gönderilmemiş kayıtlar varsa kaybolur.</div>' +
      '<button class="buton tehlike" id="sifirla">Yerel verileri sıfırla</button></div>' +
      '<div class="ortala bilgi">Ders Takip ' + SURUM + '</div>';
    var f = document.getElementById('f');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      ayar = { url: fd.get('url').trim(), key: fd.get('key').trim() };
      yaz(K.ayar, ayar);
      var b = document.getElementById('kaydet'); b.disabled = true; b.textContent = 'Test ediliyor…';
      senk().then(function (r) {
        if (r.ok) bildir('Bağlantı başarılı ✓', 'basari');
        else bildir('Bağlantı kurulamadı: ' + (r.mesaj || r.neden), 'hata');
        ciz();
      });
    });
    document.getElementById('senk').addEventListener('click', function () {
      senk().then(function (r) { bildir(r.ok ? 'Eşitlendi ✓' : 'Eşitlenemedi: ' + (r.mesaj || r.neden), r.ok ? 'basari' : 'hata'); ciz(); });
    });
    document.getElementById('sifirla').addEventListener('click', function () {
      if (!confirm('Bu telefondaki veriler silinip sunucudan yeniden indirilecek. Devam edilsin mi?')) return;
      db = { ogrenciler: [], dersler: [], odemeler: [], sonSenk: null }; outbox = []; kalici();
      senk().then(ciz);
    });
  }

  /* ---------------- Başlatma ---------------- */
  window.addEventListener('hashchange', ciz);
  window.addEventListener('online', function () { senk(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) senk(); });
  setInterval(function () { if (outbox.length || !db.sonSenk || Date.now() - db.sonSenk > 5 * 60000) senk(); }, 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW kaydı başarısız', e); });
  }
  ciz();
  senk();

  // Test için
  window.__DT = { senk: senk, durum: function () { return { db: db, outbox: outbox, ayar: ayar }; } };
})();
