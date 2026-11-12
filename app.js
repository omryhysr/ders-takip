/* HSE Ders Takip — uygulama (sürüm 3) */
(function () {
  'use strict';
  var H = window.Hesap;
  var SURUM = '3.0.0';
  var SUNUCU_SURUM = 3;

  /* ---------------- Depolama ---------------- */
  var K = { db: 'dt_db', outbox: 'dt_outbox', ayar: 'dt_ayar' };
  function oku(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Depolama hatası', e); } }

  function bosDb() { return { ogrenciler: [], dersler: [], odemeler: [], denemeler: [], silinenler: [], sonSenk: null, sunucuSurum: null }; }
  var db = Object.assign(bosDb(), oku(K.db) || {});
  var outbox = oku(K.outbox) || [];
  var ayar = Object.assign({ url: '', key: '', yetkiHatasi: false, sonYedek: 0, yedekErtele: 0 }, oku(K.ayar) || {});
  function kalici() { yaz(K.db, db); yaz(K.outbox, outbox); }

  var LISTE = { ogrenci: 'ogrenciler', ders: 'dersler', odeme: 'odemeler', deneme: 'denemeler' };

  function uygulaYerel(op) {
    var liste = db[LISTE[op.tip]];
    var id = op.kayit ? op.kayit.id : op.id;
    var i = liste.findIndex(function (k) { return k.id === id; });
    if (op.islem === 'kaydet') {
      if (i >= 0) liste[i] = op.kayit; else liste.push(op.kayit);
      db.silinenler = db.silinenler.filter(function (s) { return !(s.tip === op.tip && s.id === id); });
    } else if (op.islem === 'sil' && i >= 0) {
      db.silinenler.push({ tip: op.tip, id: id, veri: liste[i], silinmeZamani: op.zaman || new Date().toISOString() });
      liste.splice(i, 1);
    }
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
      if (!j.ok) {
        var e = new Error(j.hata || 'Sunucu hatası');
        e.sunucu = true; e.yetkisiz = j.hata === 'yetkisiz'; e.kilitli = j.hata === 'kilitli';
        throw e;
      }
      return j.sonuc;
    }, function (e) { clearTimeout(t); throw e; });
  }

  function istekTekrarli(govde) {
    var denemeler = [0, 1500, 4000];
    var i = 0;
    function dene() {
      return istek(govde).catch(function (e) {
        if (e.sunucu || i >= denemeler.length - 1) throw e;
        i++;
        return bekle(denemeler[i]).then(dene);
      });
    }
    return dene();
  }

  var senkDurum = 'bos', tekrarIste = false, sonHata = '';

  function senk(zorla) {
    if (!ayar.url || !ayar.key) return Promise.resolve({ ok: false, neden: 'ayar' });
    // Şifre yanlışsa kendiliğinden tekrar deneme: sunucu 10 yanlış denemede kilitlenir
    if (ayar.yetkiHatasi && !zorla) return Promise.resolve({ ok: false, neden: 'yetkisiz', mesaj: 'Şifre yanlış' });
    if (senkDurum === 'calisiyor') { tekrarIste = true; return Promise.resolve({ ok: false, neden: 'mesgul' }); }
    senkDurum = 'calisiyor'; durumCiz();
    var gonderilen = outbox.slice();
    var govde = gonderilen.length
      ? { islem: 'toplu', islemler: gonderilen.map(function (o) { return { islem: o.islem, tip: o.tip, kayit: o.kayit, id: o.id, zaman: o.zaman }; }) }
      : { islem: 'hepsi' };
    return istekTekrarli(govde).then(function (sonuc) {
      var veri = gonderilen.length ? sonuc.veri : sonuc;
      var gidenler = {};
      gonderilen.forEach(function (o) { gidenler[o.opId] = true; });
      outbox = outbox.filter(function (o) { return !gidenler[o.opId]; });
      db = Object.assign(bosDb(), {
        ogrenciler: veri.ogrenciler || [], dersler: veri.dersler || [], odemeler: veri.odemeler || [],
        denemeler: veri.denemeler || [], silinenler: veri.silinenler || [], sonSenk: Date.now(), sunucuSurum: veri.surum || 1
      });
      outbox.forEach(uygulaYerel);
      if (ayar.yetkiHatasi) { ayar.yetkiHatasi = false; yaz(K.ayar, ayar); }
      kalici();
      sonHata = '';
      return { ok: true };
    }).catch(function (e) {
      if (e.yetkisiz) { ayar.yetkiHatasi = true; yaz(K.ayar, ayar); sonHata = 'Şifre yanlış'; return { ok: false, neden: 'yetkisiz', mesaj: sonHata }; }
      if (e.kilitli) { sonHata = 'Çok fazla yanlış şifre denendi. 15 dakika sonra tekrar deneyin.'; return { ok: false, neden: 'kilitli', mesaj: sonHata }; }
      sonHata = e.message || 'Bağlantı hatası';
      return { ok: false, neden: 'ag', mesaj: sonHata };
    }).then(function (r) {
      senkDurum = 'bos';
      if (formAcik()) durumCiz(); else ciz();   // yazılmakta olan formu sıfırlama
      if (tekrarIste) { tekrarIste = false; senk(); }
      return r;
    });
  }

  function damgala(kayit) {
    var simdi = new Date().toISOString();
    if (!kayit.olusturma) kayit.olusturma = simdi;
    kayit.guncelleme = simdi;
    return kayit;
  }
  function opKaydet(tip, kayit) { var op = { opId: H.uid(), islem: 'kaydet', tip: tip, kayit: damgala(kayit) }; uygulaYerel(op); outbox.push(op); }
  function opSil(tip, id, zaman) { var op = { opId: H.uid(), islem: 'sil', tip: tip, id: id, zaman: zaman || new Date().toISOString() }; uygulaYerel(op); outbox.push(op); }
  function gonder(geriAl) { kalici(); return senk().then(function (r) { return sonucBildir(r, geriAl); }); }

  /** Kaydeder; bildirimde "Geri al" sunar. onceki: düzenlemeden önceki hali (yeni kayıtta yok) */
  function kaydetKayit(tip, kayit, onceki) {
    opKaydet(tip, kayit);
    return gonder(function () {
      if (onceki) opKaydet(tip, Object.assign({}, onceki)); else opSil(tip, kayit.id);
      gonder().then(ciz); ciz();
    });
  }

  function silKayit(tip, id) {
    opSil(tip, id);
    return gonder(function () { var s = silinenBul(tip, id); if (s) geriGetir(s); });
  }

  function ogrenciSil(o) {
    var zaman = new Date().toISOString();
    ['ders', 'odeme', 'deneme'].forEach(function (tip) {
      db[LISTE[tip]].filter(function (k) { return k.ogrenciId === o.id; }).forEach(function (k) { opSil(tip, k.id, zaman); });
    });
    opSil('ogrenci', o.id, zaman);
    return gonder(function () { var s = silinenBul('ogrenci', o.id); if (s) geriGetir(s); });
  }

  function silinenBul(tip, id) { return db.silinenler.find(function (s) { return s.tip === tip && s.id === id; }); }

  /** Silinmiş kaydı geri getirir. Öğrenciyse, onunla birlikte silinen ders/ödeme/denemeler de gelir. */
  function geriGetir(s) {
    if (s.tip !== 'ogrenci' && !ogrenciBul(s.veri.ogrenciId)) { bildir('Önce bu kaydın öğrencisini geri getirin.', 'uyari'); return; }
    var grup = [s];
    if (s.tip === 'ogrenci') db.silinenler.forEach(function (x) {
      if (x.tip !== 'ogrenci' && x.veri && x.veri.ogrenciId === s.id && x.silinmeZamani === s.silinmeZamani) grup.push(x);
    });
    grup.forEach(function (x) { opKaydet(x.tip, Object.assign({}, x.veri)); });
    gonder().then(ciz); ciz();
  }

  function sonucBildir(r, geriAl) {
    var eylem = geriAl ? { etiket: 'Geri al', fn: geriAl } : null;
    if (r.ok) bildir('Kaydedildi ✓', 'basari', eylem);
    else if (r.neden === 'ayar') bildir('Telefona kaydedildi. Diğer → Ayarlar\'dan bağlantıyı kurun.', 'uyari', eylem);
    else if (r.neden === 'yetkisiz') bildir('Telefona kaydedildi ama şifre yanlış. Diğer → Ayarlar\'ı kontrol edin.', 'hata', eylem);
    else if (r.neden === 'kilitli') bildir('Telefona kaydedildi. ' + r.mesaj, 'hata', eylem);
    else if (r.neden === 'mesgul') bildir('Kaydedildi, gönderiliyor…', 'basari', eylem);
    else if (!navigator.onLine) bildir('Telefona kaydedildi ✓ İnternet gelince gönderilecek.', 'uyari', eylem);
    else bildir('Kaydedilemedi, tekrar denenecek (' + r.mesaj + ')', 'hata', eylem);
    return r;
  }

  /* ---------------- Bildirim ---------------- */
  var bildirimZamanlayici;
  function bildir(metin, tur, eylem) {
    var b = document.getElementById('bildirim');
    b.innerHTML = '<span class="b-metin"></span>';
    b.firstChild.textContent = metin;
    if (eylem) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'b-eylem'; btn.textContent = eylem.etiket;
      btn.addEventListener('click', function () { b.hidden = true; eylem.fn(); });
      b.appendChild(btn);
    }
    b.className = tur || ''; b.hidden = false;
    b.firstChild.addEventListener('click', function () { b.hidden = true; });   // dokununca kapanır
    clearTimeout(bildirimZamanlayici);
    bildirimZamanlayici = setTimeout(function () { b.hidden = true; }, eylem ? 6000 : (tur === 'hata' ? 5000 : 2500));
  }

  /* ---------------- Yardımcılar ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ogrenciBul(id) { return db.ogrenciler.find(function (o) { return o.id === id; }); }
  function aktifOgrenciler() { return db.ogrenciler.filter(function (o) { return o.durum !== 'pasif'; }).sort(adSirala); }
  function adSirala(a, b) { return (a.ad || '').localeCompare(b.ad || '', 'tr'); }
  function veliTel(o) { return o.veliTel || o.telefon || ''; }
  function bakiyeHtml(borc, kisa) {
    if (borc > 0) return '<span class="borc">' + (kisa ? '' : 'Borç: ') + H.formatTL(borc) + '</span>';
    if (borc < 0) return '<span class="avans">' + (kisa ? '' : 'Avans: ') + H.formatTL(-borc) + '</span>';
    return '<span class="sifir">' + (kisa ? '0 ₺' : 'Borcu yok') + '</span>';
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
  function saat(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var g = H.bugun(d), b = H.bugun();
    var s = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return g === b ? 'bugün ' + s : H.formatTarih(g) + ' ' + s;
  }
  function telButonlari(etiket, tel) {
    if (!tel) return '';
    return '<div class="tel-satir"><span class="tel-etiket">' + etiket + '</span>' +
      '<a class="buton ikincil kucuk" href="tel:' + esc(tel.replace(/\s/g, '')) + '">📞 Ara</a>' +
      '<a class="buton yesil kucuk" href="https://wa.me/' + esc(H.telefonUluslararasi(tel)) + '" target="_blank" rel="noopener">💬 WhatsApp</a></div>';
  }

  /* ---------------- Sesli giriş ---------------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var aktifSes = null;
  function sesliAlan(etiket, ad, deger, cokSatir) {
    var alan = cokSatir
      ? '<textarea name="' + ad + '">' + esc(deger) + '</textarea>'
      : '<input type="text" name="' + ad + '" value="' + esc(deger) + '" autocomplete="off">';
    return '<label class="alan"><span>' + etiket + '</span><div class="sesli">' + alan +
      (SR ? '<button type="button" class="mik" data-hedef="' + ad + '" aria-label="Konuşarak yaz">🎤</button>' : '') + '</div></label>';
  }
  function sesBagla(kok) {
    kok.querySelectorAll('.mik').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (aktifSes) { try { aktifSes.stop(); } catch (e) {} return; }
        var hedef = kok.querySelector('[name="' + btn.getAttribute('data-hedef') + '"]');
        var r;
        try { r = new SR(); } catch (e) { bildir('Bu telefonda sesli yazma desteklenmiyor.', 'hata'); return; }
        r.lang = 'tr-TR'; r.interimResults = false; r.maxAlternatives = 1;
        r.onresult = function (e) {
          var t = String(e.results[0][0].transcript || '').trim();
          if (!t) return;
          var once = hedef.value.replace(/\s+$/, '');
          if (!once) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
          hedef.value = once ? once + ' ' + t : t;
          hedef.dispatchEvent(new Event('input'));
        };
        r.onerror = function (e) {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') bildir('Mikrofon izni verilmedi. Tarayıcı ayarlarından izin verin.', 'hata');
          else if (e.error !== 'aborted' && e.error !== 'no-speech') bildir('Ses alınamadı, tekrar deneyin.', 'hata');
        };
        r.onend = function () { btn.classList.remove('dinliyor'); aktifSes = null; };
        aktifSes = r; btn.classList.add('dinliyor');
        try { r.start(); } catch (e) { btn.classList.remove('dinliyor'); aktifSes = null; }
      });
    });
  }

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
    if (ayar.yetkiHatasi) { d.textContent = 'Şifre yanlış'; d.className += ' hata'; return; }
    if (outbox.length) { d.textContent = outbox.length + ' kayıt bekliyor'; d.className += ' bekliyor'; return; }
    if (sonHata) { d.textContent = 'Bağlantı yok'; d.className += ' hata'; return; }
    if (db.sonSenk) { var t = new Date(db.sonSenk); d.textContent = '✓ ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); return; }
    d.textContent = '';
  }

  function formAcik() {
    var p = rota().parca;
    return p[0] === 'ders' || p[0] === 'odeme' || p[0] === 'deneme' || p[0] === 'mesaj' ||
      (p[0] === 'ogrenci' && (p[1] === 'yeni' || p[2] === 'duzenle')) || (p[0] === 'diger' && (p[1] === 'ayarlar' || p[1] === 'muhasebe'));
  }

  function filigranCiz(ad) {
    var f = document.getElementById('filigran');
    if (!f || f.getAttribute('data-cicek') === ad) return;
    f.setAttribute('data-cicek', ad);
    f.className = 'cicek-' + ad;
    f.innerHTML = window.Cicek ? window.Cicek.svg(ad) : '';
  }

  var sonRota = '';
  function ciz() {
    var r = rota();
    var p = r.parca;
    var icerik = document.getElementById('icerik');
    var nav = 'ana', cicek = 'gul';
    if (aktifSes) { try { aktifSes.stop(); } catch (e) {} }
    try {
      if (p.length === 0) { ekranAna(icerik); }
      else if (p[0] === 'ozel') { nav = 'ozel'; cicek = 'zambak'; ekranOzel(icerik, p[1] === 'dersler' ? 'dersler' : 'ogrenciler'); }
      else if (p[0] === 'ogrenciler') { location.hash = '#/ozel'; return; }
      else if (p[0] === 'ekle') { nav = 'ekle'; cicek = 'lale'; ekranEkle(icerik); }
      else if (p[0] === 'ogrenci' && p[1] === 'yeni') { nav = 'ekle'; cicek = 'lale'; ekranOgrenciFormu(icerik, null); }
      else if (p[0] === 'ogrenci' && p[2] === 'duzenle') { nav = 'ozel'; cicek = 'zambak'; ekranOgrenciFormu(icerik, p[1]); }
      else if (p[0] === 'ogrenci' && p[1]) { nav = 'ozel'; cicek = 'zambak'; ekranOgrenciKarti(icerik, p[1], r.q); }
      else if (p[0] === 'ders') { nav = p[1] === 'yeni' ? 'ekle' : 'ozel'; cicek = 'lale'; ekranDersFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'odeme') { nav = p[1] === 'yeni' ? 'ekle' : 'ozel'; cicek = 'papatya'; ekranOdemeFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'deneme') { nav = 'ozel'; cicek = 'zambak'; ekranDenemeFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'mesaj' && p[1]) { nav = 'rapor'; cicek = 'nilufer'; ekranMesaj(icerik, p[1], r.q); }
      else if (p[0] === 'rapor') { nav = 'rapor'; cicek = 'nilufer'; ekranRapor(icerik, p[1] === 'ogrenci' ? 'ogrenci' : 'genel', r.q); }
      else if (p[0] === 'diger') { nav = 'diger'; cicek = 'lavanta'; ekranDiger(icerik, p[1] || 'alacak', r.q); }
      else if (p[0] === 'ayarlar') { location.hash = '#/diger/ayarlar'; return; }
      else { location.hash = '#/'; return; }
    } catch (e) {
      console.error(e);
      icerik.innerHTML = '<div class="kart"><b>Bir hata oluştu:</b> ' + esc(e.message) + '</div>';
    }
    filigranCiz(cicek);
    document.querySelectorAll('#alt-menu a').forEach(function (a) { a.classList.toggle('aktif', a.getAttribute('data-nav') === nav); });
    if (location.hash !== sonRota) { window.scrollTo(0, 0); sonRota = location.hash; }
  }

  /* ---------------- Ortak görünüm parçaları ---------------- */
  function sekmeCubugu(liste, aktif) {
    return '<div class="sekmeler">' + liste.map(function (s) {
      return '<a href="' + s[0] + '"' + (s[2] === aktif ? ' class="aktif"' : '') + '>' + s[1] + '</a>'; }).join('') + '</div>';
  }
  function tikRozetleri(d, en) {
    var l = H.tikListe(d);
    if (en && l.length > en) l = l.slice(0, en);
    return l.map(function (k) {
      var t = H.TIKLER.filter(function (x) { return x.k === k; })[0];
      return '<span class="rozet ' + (t.olumlu ? 'olumlu' : 'olumsuz') + '">' + esc(t.ad) + '</span>';
    }).join(' ');
  }
  function odemeRozet(d, e) {
    if (H.iptalMi(d)) return '';
    e = e || {};
    if (e.durum === 'ucretsiz') return '<span class="rozet">Ücretsiz</span>';
    if (d.odeme === 'nakit') return '<span class="rozet nakit">Elden alındı</span>';
    if (d.odeme === 'havale') return '<span class="rozet havale">EFT alındı</span>';
    if (e.durum === 'odendi') return '<span class="rozet nakit">Sonradan ödendi</span>';
    if (e.durum === 'kismen') return '<span class="rozet kismen">Kısmen: ' + esc(H.formatTL(e.odenen)) + ' / ' + esc(H.formatTL(d.tutar)) + '</span>';
    return '<span class="rozet odenmedi">Ödenmedi</span>';
  }
  function donemler() {
    var b = H.bugun(), ey = H.egitimYili(b), ay = b.slice(0, 7);
    var oy = +ay.slice(5, 7) === 1 ? (+ay.slice(0, 4) - 1) + '-12' : ay.slice(0, 5) + ('0' + (+ay.slice(5, 7) - 1)).slice(-2);
    return [
      { k: 'yil', ad: 'Bu eğitim yılı (' + ey.ad + ')', kisa: ey.ad + ' eğitim yılı', bas: ey.baslangic, bit: ey.bitis },
      { k: 'ay', ad: 'Bu ay (' + H.ayAdi(ay) + ')', kisa: H.ayAdi(ay), bas: ay + '-01', bit: ay + '-31' },
      { k: 'gecenay', ad: 'Geçen ay (' + H.ayAdi(oy) + ')', kisa: H.ayAdi(oy), bas: oy + '-01', bit: oy + '-31' },
      { k: 'tum', ad: 'Tüm zamanlar', kisa: 'bugüne kadarki', bas: null, bit: null }
    ];
  }
  function donemBul(k) { var l = donemler(); return l.filter(function (d) { return d.k === k; })[0] || l[0]; }
  function donemSecenekleri(secili, ek) {
    return donemler().concat(ek || []).map(function (d) { return '<option value="' + d.k + '"' + (d.k === secili ? ' selected' : '') + '>' + esc(d.ad) + '</option>'; }).join('');
  }
  function gelecekOnay(tarih, ne) {
    return tarih <= H.bugun() || confirm(H.formatTarih(tarih) + ' bugünden ileri bir tarih.\n\nBu ' + ne + ' yine de bu tarihle kaydedilsin mi?');
  }
  function xlsxIndir(sayfalar, ad) {
    var blob = new Blob([window.Yedek.xlsx(sayfalar)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = ad;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------------- Ana sayfa ---------------- */
  var YEDEK_GUN = 7;
  function ekranAna(el) {
    baslikCiz('HSE Ders Takip');
    var bugun = H.bugun(), ay = bugun.slice(0, 7);
    var o = H.ayOzeti(ay, db.dersler, db.odemeler);
    var html = '';
    if (!ayar.url || !ayar.key) {
      html += '<div class="ipucu"><b>Bağlantı kurulmadı.</b> Girdiğiniz kayıtlar şimdilik yalnızca bu telefonda saklanır. <a href="#/diger/ayarlar">Diğer → Ayarlar</a> ekranından web uygulaması adresini ve şifreyi girin.</div>';
    } else if (ayar.yetkiHatasi) {
      html += '<div class="ipucu"><b>Şifre yanlış.</b> Şifre değiştirildiyse yenisini <a href="#/diger/ayarlar">Diğer → Ayarlar</a> ekranına girin. Kayıtlarınız telefonda bekliyor.</div>';
    } else if (db.sonSenk && db.sunucuSurum && db.sunucuSurum < SUNUCU_SURUM) {
      html += '<div class="ipucu" id="eskiKod"><b>Google tarafındaki kod eski.</b> İptal dersler, öğrenci durumu ve ders notları doğru kaydedilmez. Kılavuzdaki "Google tarafını güncelleme" adımını yapın.</div>';
    }
    var kayitVar = db.dersler.length + db.odemeler.length > 0;
    var sonY = Math.max(ayar.sonYedek || 0, ayar.yedekErtele || 0);
    if (kayitVar && Date.now() - sonY > YEDEK_GUN * 86400000) {
      html += '<div class="ipucu" id="yedekUyari"><b>Yedek zamanı.</b> ' + (ayar.sonYedek ? 'Son Excel yedeğini ' + esc(H.kacGunOnce(H.bugun(new Date(ayar.sonYedek)), bugun)) + ' aldınız.' : 'Bu telefonda henüz Excel yedeği alınmadı.') +
        '<div class="buton-sira" style="margin:8px 0 0"><a class="buton kucuk" href="#/diger/yedek">Yedek al</a><button class="buton kucuk ikincil" id="yedekErtele">Sonra hatırlat</button></div></div>';
    }
    html += '<div class="buyuk-butonlar"><a class="buton" href="#/ders/yeni">+ Ders</a><a class="buton yesil" href="#/odeme/yeni">+ Ödeme</a></div>';
    html += '<div class="kart" id="ayOzet"><h2>' + esc(H.ayAdi(ay)) + '</h2><div class="ozet iki-sutun">' +
      '<div><div class="deger">' + H.formatSayi(o.dersSayisi) + '</div><div class="etiket">bu ay yapılan ders</div></div>' +
      '<div><div class="deger">' + H.formatSayi(H.toplamYapilan(db.dersler)) + '</div><div class="etiket">toplam yapılan ders</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.kazanilan)) + '</div><div class="etiket">kazanılan</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.tahsil)) + '</div><div class="etiket">tahsil edilen</div></div></div></div>';
    var liste = H.neredeKaldik(db.ogrenciler, db.dersler, bugun);
    html += '<div class="kart" id="nerede"><h2>Nerede kaldık</h2>';
    if (!liste.length) html += '<div class="bos">Henüz öğrenci yok.<br><br><a class="buton kucuk" href="#/ogrenci/yeni">+ Öğrenci</a></div>';
    liste.forEach(function (x) {
      var og = x.ogrenci, s = x.son, k = x.sonKayit;
      html += '<a class="satir" href="#/ogrenci/' + esc(og.id) + '"><div class="sol"><div class="ad">' + esc(og.ad) + ' <span class="rozet">' + esc(og.sinif) + '</span></div>';
      if (!k) html += '<div class="alt">Henüz ders yapılmadı</div>';
      else if (x.ayni) html += '<div class="alt sarili">' + esc(H.gunluTarih(s.tarih)) + ' · ' + esc(H.kacGunOnce(s.tarih, bugun)) + '</div>';
      else {
        html += '<div class="alt sarili"><b>Son kayıt:</b> ' + esc(H.gunluTarih(k.tarih)) + ' · <span class="rozet notr">iptal edildi</span>' + (k.iptalNot ? ' ' + esc(k.iptalNot) : '') + '</div>';
        html += '<div class="alt sarili"><b>Son yapılan ders:</b> ' + (s ? esc(H.gunluTarih(s.tarih)) + ' · ' + esc(H.kacGunOnce(s.tarih, bugun)) : 'henüz yok') + '</div>';
      }
      if (s) html += '<div class="alt sarili"><b>Sonraki derste:</b> ' + esc(s.kaldigimYer || '—') + '</div>';
      var tr = s ? tikRozetleri(s, 2) : '';
      if (tr) html += '<div class="rozet-sira">' + tr + '</div>';
      html += '</div></a>';
    });
    html += '</div>';
    el.innerHTML = html;
    var ye = document.getElementById('yedekErtele');
    if (ye) ye.addEventListener('click', function () { ayar.yedekErtele = Date.now(); yaz(K.ayar, ayar); ciz(); });
  }

  /* ---------------- Özel Ders: Öğrenciler | Dersler ---------------- */
  var ogrAra = '', pasifGoster = false, dersAy = null, dersOgr = '';
  function ekranOzel(el, sekme) {
    baslikCiz('Özel Ders');
    el.innerHTML = sekmeCubugu([['#/ozel', 'Öğrenciler', 'ogrenciler'], ['#/ozel/dersler', 'Dersler', 'dersler']], sekme) + '<div id="sekme"></div>';
    if (sekme === 'dersler') sekmeDersler(document.getElementById('sekme')); else sekmeOgrenciler(document.getElementById('sekme'));
  }

  function sekmeOgrenciler(el) {
    var liste = db.ogrenciler.slice().sort(adSirala);
    el.innerHTML = '<input class="arama" type="text" id="ara" placeholder="Ara…" value="' + esc(ogrAra) + '" autocomplete="off">' +
      '<div class="kart" id="ogrListe"></div>' +
      '<div class="kontrol"><label><input type="checkbox" id="pasifGoster"' + (pasifGoster ? ' checked' : '') + '> Pasif öğrencileri göster</label></div>' +
      '<a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a>';
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

  function sekmeDersler(el) {
    var buAy = H.bugun().slice(0, 7);
    var aylar = {}; aylar[buAy] = true;
    db.dersler.forEach(function (d) { if (d.tarih && d.tarih.length >= 7) aylar[d.tarih.slice(0, 7)] = true; });
    var ayListe = Object.keys(aylar).sort().reverse();
    if (dersAy === null || (dersAy !== 'tum' && !aylar[dersAy])) dersAy = buAy;
    if (dersOgr && !ogrenciBul(dersOgr)) dersOgr = '';
    var esl = H.tumEslestirme(db);
    var liste = db.dersler.filter(function (d) { return (dersAy === 'tum' || (d.tarih || '').slice(0, 7) === dersAy) && (!dersOgr || d.ogrenciId === dersOgr); })
      .sort(function (a, b) { return H.siralaAnahtar(a) < H.siralaAnahtar(b) ? 1 : -1; });
    var kazanilan = 0, alacak = 0, yapilan = 0, iptal = 0;
    liste.forEach(function (d) {
      if (H.iptalMi(d)) { iptal++; return; }
      yapilan += sayi(d.dersSayisi); kazanilan += sayi(d.tutar); alacak += (esl[d.id] ? esl[d.id].kalan : 0);
    });
    var odemeler = db.odemeler.filter(function (p) { return !dersOgr || p.ogrenciId === dersOgr; });
    var dersSuz = db.dersler.filter(function (d) { return !dersOgr || d.ogrenciId === dersOgr; });
    var tahsil = dersAy === 'tum' ? H.donemOzeti(null, null, dersSuz, odemeler).tahsil : H.ayOzeti(dersAy, dersSuz, odemeler).tahsil;
    var html = '<div class="iki"><label class="alan"><span>Dönem</span><select id="dAy">' + ayListe.map(function (a) {
      return '<option value="' + a + '"' + (a === dersAy ? ' selected' : '') + '>' + esc(H.ayAdi(a)) + '</option>'; }).join('') +
      '<option value="tum"' + (dersAy === 'tum' ? ' selected' : '') + '>Tüm zamanlar</option></select></label>' +
      '<label class="alan"><span>Öğrenci</span><select id="dOgr"><option value="">Hepsi</option>' + db.ogrenciler.slice().sort(adSirala).map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === dersOgr ? ' selected' : '') + '>' + esc(o.ad) + '</option>'; }).join('') + '</select></label></div>';
    html += '<div class="kart" id="dersOzet"><div class="ozet">' +
      '<div><div class="deger avans">' + esc(H.formatTL(tahsil)) + '</div><div class="etiket">tahsil edilen</div></div>' +
      '<div><div class="deger borc">' + esc(H.formatTL(alacak)) + '</div><div class="etiket">alacak</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(kazanilan)) + '</div><div class="etiket">kazanılan</div></div></div>' +
      '<div class="bilgi ortala" style="margin:10px 0 0">' + H.formatSayi(yapilan) + ' ders yapıldı' + (iptal ? ' · ' + iptal + ' iptal' : '') + '</div></div>';
    html += '<div class="kart" id="dersListe">';
    if (!liste.length) html += '<div class="bos">Bu dönemde ders kaydı yok.</div>';
    liste.forEach(function (d) {
      var og = ogrenciBul(d.ogrenciId), ip = H.iptalMi(d);
      html += '<a class="satir" href="#/ders/' + esc(d.id) + '"><div class="sol"><div class="ad">' + esc(og ? og.ad : '?') + ' ' +
        (ip ? '<span class="rozet notr">İptal edildi</span>' : '<span class="rozet">Ders yapıldı' + (sayi(d.dersSayisi) !== 1 ? ' ×' + esc(H.formatSayi(d.dersSayisi)) : '') + '</span>') + '</div>' +
        '<div class="alt sarili">' + esc(H.gunluTarih(d.tarih)) + (ip ? ' · ücret yok' : (d.konu ? ' · ' + esc(d.konu) : '')) + '</div>' +
        (ip ? (d.iptalNot ? '<div class="alt sarili">Not: ' + esc(d.iptalNot) + '</div>' : '') : '<div class="rozet-sira">' + odemeRozet(d, esl[d.id]) + '</div>') +
        '</div><div class="sag">' + (ip ? '<span class="sifir">0 ₺</span>' : '<b>' + esc(H.formatTL(d.tutar)) + '</b>') + '</div></a>';
    });
    html += '</div>';
    html += '<div class="bilgi"><b>Tahsil edilen:</b> seçili dönemde elinize geçen para (hangi dersin parası olursa olsun). <b>Alacak:</b> listedeki derslerden henüz ödenmeyen kısım. Sonradan gelen ödemeler en eski dersten başlayarak sayılır.</div>';
    el.innerHTML = html;
    document.getElementById('dAy').addEventListener('change', function (e) { dersAy = e.target.value; sekmeDersler(el); });
    document.getElementById('dOgr').addEventListener('change', function (e) { dersOgr = e.target.value; sekmeDersler(el); });
  }

  /* ---------------- Ekle ---------------- */
  function ekranEkle(el) {
    baslikCiz('Ekle');
    el.innerHTML =
      '<a class="buyuk-kart" href="#/ders/yeni"><span class="bk-ikon">✎</span><span><b>Ders ekle</b><span>Yapılan ya da iptal edilen ders</span></span></a>' +
      '<a class="buyuk-kart" href="#/odeme/yeni"><span class="bk-ikon yesil">₺</span><span><b>Ödeme ekle</b><span>Derste alınmayan, sonradan gelen ödeme</span></span></a>' +
      '<a class="buyuk-kart" href="#/ogrenci/yeni"><span class="bk-ikon koyu">☺</span><span><b>Öğrenci ekle</b><span>Yeni öğrenci kaydı</span></span></a>';
  }

  /* ---------------- Öğrenci kartı ---------------- */
  function netGrafik(netler) {
    if (netler.length < 3) return '';
    var min = Math.min.apply(null, netler), max = Math.max.apply(null, netler);
    var W = 300, Hh = 70, pad = 12, ar = (max - min) || 1;
    var nok = netler.map(function (n, i) { return { x: pad + i * (W - 2 * pad) / (netler.length - 1), y: Hh - pad - (n - min) * (Hh - 2 * pad) / ar }; });
    return '<svg class="grafik" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Net gelişimi"><polyline fill="none" stroke="#A15668" stroke-width="2.5" stroke-linejoin="round" points="' +
      nok.map(function (n) { return n.x.toFixed(1) + ',' + n.y.toFixed(1); }).join(' ') + '"/>' +
      nok.map(function (n) { return '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="3.5" fill="#A15668"/>'; }).join('') + '</svg>';
  }
  function denemeGruplariHtml(gruplar) {
    var html = '';
    gruplar.forEach(function (g) {
      var n = g.netler.map(function (x) { return x.net; });
      html += '<div class="deneme-grup"><div class="alan-baslik">' + esc(g.ad) + ' · ' + g.sinavlar.length + ' sınav</div>';
      if (n.length >= 3) html += netGrafik(n) + '<div class="grafik-alt"><span>İlk: ' + H.formatSayi(n[0]) + ' net</span><span>Son: ' + H.formatSayi(n[n.length - 1]) + ' net</span></div>';
      else if (n.length === 2) html += '<div class="bilgi">' + H.formatSayi(n[0]) + ' net → ' + H.formatSayi(n[1]) + ' net <span class="ince">(eğilim için en az 3 sınav gerekir)</span></div>';
      else if (n.length === 1) html += '<div class="bilgi">' + H.formatSayi(n[0]) + ' net</div>';
      html += '</div>';
    });
    return html;
  }

  var kartDonem = 'tum';
  function ekranOgrenciKarti(el, id, q) {
    var o = ogrenciBul(id);
    if (!o) { baslikCiz('Öğrenci', '#/ozel'); el.innerHTML = '<div class="bos">Öğrenci bulunamadı.</div>'; return; }
    baslikCiz(o.ad, '#/ozel');
    var b = H.bakiye(o.id, db.dersler, db.odemeler);
    var son = H.sonDers(o.id, db.dersler);
    var dn = kartDonem === 'yil' ? donemBul('yil') : donemBul('tum');
    var z = H.ogrenciOzeti(o.id, db, dn.bas, dn.bit);
    var esl = H.odemeEslestir(o.id, db.dersler, db.odemeler);
    var html = '';
    var yeniDers = q && q.yeni ? db.dersler.find(function (d) { return d.id === q.yeni; }) : null;
    if (yeniDers && !H.iptalMi(yeniDers)) html += '<div class="kart vurgu" id="yeniDers"><b>Ders kaydedildi.</b> Bu dersin özetini WhatsApp\'tan göndermek ister misiniz?' +
      '<a class="buton yesil kucuk" style="margin-top:10px;width:100%" href="#/mesaj/' + esc(o.id) + '?tur=ders&ders=' + esc(yeniDers.id) + '">💬 Bilgilendirme gönder</a></div>';
    html += '<div class="kart"><div class="bakiye-buyuk">' + bakiyeHtml(b.borc) + '</div>' +
      '<div class="ortala bilgi">' + esc(o.sinif) + ' · ' + esc(H.formatTL(o.ucret)) + '/ders' + (o.durum === 'pasif' ? ' · <span class="rozet pasif">pasif</span>' : '') + '</div>';
    html += telButonlari('Veli', veliTel(o)) + telButonlari('Öğrenci', o.ogrenciTel);
    if (o.not) html += '<div class="bilgi">' + esc(o.not) + '</div>';
    if (son && son.kaldigimYer) html += '<div class="ipucu"><b>Sonraki derste:</b> ' + esc(son.kaldigimYer) + '</div>';
    if (son && son.odev) html += '<div class="bilgi"><b>Son ödev:</b> ' + esc(son.odev) + '</div>';
    html += '<div class="buton-sira"><a class="buton" href="#/ders/yeni?ogr=' + esc(o.id) + '">+ Ders</a><a class="buton yesil" href="#/odeme/yeni?ogr=' + esc(o.id) + '">+ Ödeme</a></div>' +
      '<div class="buton-sira"><a class="buton ikincil kucuk" href="#/rapor/ogrenci?ogr=' + esc(o.id) + '">📊 Rapor</a><a class="buton ikincil kucuk" href="#/mesaj/' + esc(o.id) + '">💬 Mesaj</a></div>' +
      '<div class="buton-sira" style="margin-bottom:0"><a class="buton ikincil kucuk" href="#/deneme/yeni?ogr=' + esc(o.id) + '">+ Deneme</a><a class="buton ikincil kucuk" href="#/ogrenci/' + esc(o.id) + '/duzenle">Düzenle</a>' +
      '<button class="buton ikincil kucuk" id="durumDegistir">' + (o.durum === 'pasif' ? 'Aktif yap' : 'Pasif yap') + '</button></div></div>';

    var satir = function (e, d, sinif) { return '<div class="ozet-satir"><span>' + e + '</span><b' + (sinif ? ' class="' + sinif + '"' : '') + '>' + d + '</b></div>'; };
    html += '<div class="kart" id="ogrOzet"><h2>Özet</h2><div class="secenekler ince-sec" style="margin-bottom:10px">' +
      '<label><input type="radio" name="kd" value="tum"' + (kartDonem !== 'yil' ? ' checked' : '') + '><span>Tüm zamanlar</span></label>' +
      '<label><input type="radio" name="kd" value="yil"' + (kartDonem === 'yil' ? ' checked' : '') + '><span>Bu eğitim yılı</span></label></div>' +
      '<div class="ozet iki-sutun" style="margin-bottom:10px"><div><div class="deger" id="ozYapilan">' + H.formatSayi(z.yapilan) + '</div><div class="etiket">yapılan ders</div></div>' +
      '<div><div class="deger" id="ozIptal">' + z.iptal + '</div><div class="etiket">iptal edilen ders</div></div></div>' +
      satir('Toplam ders ücreti', esc(H.formatTL(z.ucret))) +
      satir('Toplam ödenen', esc(H.formatTL(z.odenen)), 'avans') +
      satir('<span class="girinti">derste alınan</span>', esc(H.formatTL(z.dersteAlinan))) +
      satir('<span class="girinti">sonradan ödenen</span>', esc(H.formatTL(z.sonradan))) +
      satir(b.borc < 0 ? 'Avans (peşin bakiye)' : 'Kalan borç', esc(H.formatTL(Math.abs(b.borc))), b.borc > 0 ? 'borc' : (b.borc < 0 ? 'avans' : 'sifir')) +
      (kartDonem === 'yil' ? '<div class="bilgi" style="margin:6px 0">Ücret ve ödenen yalnızca bu eğitim yılını gösterir; borç her zaman bugünkü toplam durumdur.</div>' : '') +
      satir('İlk ders', z.ilkDers ? esc(H.formatTarih(z.ilkDers)) : '—') +
      satir('Son yapılan ders', z.sonDers ? esc(H.formatTarih(z.sonDers)) : '—') +
      satir('Son ödeme (sonradan)', z.sonOdeme ? esc(H.formatTarih(z.sonOdeme)) : '—') + '</div>';

    var r = H.ogrenciRaporu(o.id, db);
    var den = db.denemeler.filter(function (d) { return d.ogrenciId === o.id; }).sort(function (a, b2) { return H.siralaAnahtar(a) < H.siralaAnahtar(b2) ? 1 : -1; });
    if (den.length) {
      html += '<div class="kart" id="denemeler"><h2>Denemeler</h2>' + denemeGruplariHtml(r.denemeler);
      den.forEach(function (d) {
        var n = H.sayiVeyaBos(d.net), pu = H.sayiVeyaBos(d.puan);
        html += '<a class="satir" href="#/deneme/' + esc(d.id) + '"><div class="sol"><div class="ad">' + esc(d.ad) + '</div><div class="alt sarili">' + esc(H.formatTarih(d.tarih)) + (d.not ? ' · ' + esc(d.not) : '') + '</div></div>' +
          '<div class="sag"><b>' + (n !== null ? H.formatSayi(n) + ' net' : '') + '</b>' + (pu !== null ? '<div class="alt">' + H.formatSayi(pu) + ' puan</div>' : '') + '</div></a>';
      });
      html += '</div>';
    }

    var g = H.gecmis(o.id, db.dersler, db.odemeler);
    html += '<div class="kart" id="gecmis"><h2>Geçmiş</h2>';
    if (!g.length) html += '<div class="bos">Henüz kayıt yok.</div>';
    g.forEach(function (s) {
      var k = s.kayit;
      if (s.tip === 'ders' && H.iptalMi(k)) {
        html += '<a class="satir" href="#/ders/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · <span class="rozet notr">İptal edildi</span></div>' +
          (k.iptalNot ? '<div class="alt sarili">' + esc(k.iptalNot) + '</div>' : '') + '</div><div class="sag">' + bakiyeHtml(s.bakiye, true) + '</div></a>';
      } else if (s.tip === 'ders') {
        var tr = tikRozetleri(k);
        html += '<a class="satir" href="#/ders/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · Ders' + (sayi(k.dersSayisi) !== 1 ? ' ×' + esc(k.dersSayisi) : '') + ' · ' + esc(H.formatTL(k.tutar)) + '</div>' +
          '<div class="rozet-sira">' + odemeRozet(k, esl[k.id]) + '</div>' +
          '<div class="alt sarili">' + (k.konu ? esc(k.konu) : '<i>konu yazılmadı</i>') + (k.kaldigimYer ? ' → ' + esc(k.kaldigimYer) : '') +
          (k.odev ? '<br>Ödev: ' + esc(k.odev) + (H.ODEV_ETIKET[k.odevDurum] ? ' <span class="rozet odev-' + esc(k.odevDurum) + '">' + H.ODEV_ETIKET[k.odevDurum] + '</span>' : '') : '') +
          (k.ozelNot ? '<br>🔒 ' + esc(k.ozelNot) : '') + '</div>' +
          (tr ? '<div class="rozet-sira">' + tr + '</div>' : '') + '</div>' +
          '<div class="sag">' + bakiyeHtml(s.bakiye, true) + '</div></a>';
      } else {
        html += '<a class="satir" href="#/odeme/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · Ödeme ' + esc(H.formatTL(k.tutar)) + ' <span class="rozet ' + esc(k.yontem) + '">' + (H.YONTEM_ETIKET[k.yontem] || 'Elden') + '</span></div>' +
          (k.not ? '<div class="alt sarili">' + esc(k.not) + '</div>' : '') + '</div><div class="sag">' + bakiyeHtml(s.bakiye, true) + '</div></a>';
      }
    });
    html += '</div>';
    el.innerHTML = html;
    document.getElementById('durumDegistir').addEventListener('click', function () {
      kaydetKayit('ogrenci', Object.assign({}, o, { durum: o.durum === 'pasif' ? 'aktif' : 'pasif' }), o).then(ciz);
    });
    el.querySelectorAll('input[name=kd]').forEach(function (x) { x.addEventListener('change', function () { kartDonem = x.value; var y = window.scrollY; ekranOgrenciKarti(el, id, {}); window.scrollTo(0, y); }); });
  }

  /* ---------------- Öğrenci formu ---------------- */
  function ekranOgrenciFormu(el, id) {
    var o = id ? ogrenciBul(id) : null;
    if (id && !o) { location.hash = '#/ozel'; return; }
    baslikCiz(o ? 'Öğrenciyi düzenle' : 'Yeni öğrenci', o ? '#/ogrenci/' + o.id : '#/ozel');
    var yeniId = o ? o.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Ad soyad *</span><input type="text" name="ad" required value="' + esc(o ? o.ad : '') + '" autocomplete="off"></label>' +
      '<label class="alan"><span>Sınıf</span><select name="sinif">' + sinifSecenekleri(o ? o.sinif : '') + '</select></label>' +
      '<label class="alan"><span>Ders başı ücret (₺) *</span><input type="number" name="ucret" inputmode="decimal" step="any" min="0" required value="' + esc(o ? o.ucret : '') + '"></label>' +
      (o ? '<div class="bilgi">Ücreti değiştirmek yalnızca bundan sonra girilen dersleri etkiler; eski dersler değişmez.</div>' : '') +
      '<label class="alan"><span>Veli cep telefonu</span><input type="tel" name="veliTel" value="' + esc(o ? veliTel(o) : '') + '" placeholder="05xx xxx xx xx"></label>' +
      '<label class="alan"><span>Öğrenci cep telefonu</span><input type="tel" name="ogrenciTel" value="' + esc(o ? o.ogrenciTel || '' : '') + '" placeholder="05xx xxx xx xx"></label>' +
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
      var vt = fd.get('veliTel').trim();
      var kayit = Object.assign({}, o || {}, {
        id: yeniId, ad: fd.get('ad').trim(), sinif: fd.get('sinif'), ucret: sayi(fd.get('ucret')),
        veliTel: vt, telefon: vt, ogrenciTel: fd.get('ogrenciTel').trim(), not: fd.get('not').trim(), durum: fd.get('durum')
      });
      kaydetKayit('ogrenci', kayit, o);
      location.hash = '#/ogrenci/' + yeniId;
    });
    if (o) document.getElementById('sil').addEventListener('click', function () {
      if (!ogrenciSilOnay(o)) return;
      ogrenciSil(o);
      location.hash = '#/ozel';
    });
  }
  function ogrenciSilOnay(o) {
    var say = function (l) { return l.filter(function (d) { return d.ogrenciId === o.id; }).length; };
    var ds = say(db.dersler), os = say(db.odemeler), es = say(db.denemeler);
    return confirm('"' + o.ad + '" silinsin mi?' + (ds || os || es ? '\n\nÖğrencinin ' + ds + ' ders, ' + os + ' ödeme ve ' + es + ' deneme kaydı da silinecek.' : '') +
      '\n\nBırakan öğrenciyi silmek yerine "Pasif yap" seçeneğini kullanmanız önerilir. (Silineni Diğer → Son işlemler\'den geri getirebilirsiniz.)');
  }

  /* ---------------- Ders formu ---------------- */
  function ekranDersFormu(el, id, q) {
    var d = id ? db.dersler.find(function (x) { return x.id === id; }) : null;
    if (id && !d) { location.hash = '#/'; return; }
    var ogrId = d ? d.ogrenciId : (q.ogr || '');
    var dIptal = d ? H.iptalMi(d) : false;
    baslikCiz(d ? 'Dersi düzenle' : 'Ders ekle', d ? '#/ogrenci/' + d.ogrenciId : (ogrId ? '#/ogrenci/' + ogrId : '#/ekle'));
    if (!db.ogrenciler.length) { el.innerHTML = '<div class="kart bos">Önce bir öğrenci ekleyin.<br><br><a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a></div>'; return; }
    var yeniId = d ? d.id : H.uid();
    var seciliTik = d ? H.tikListe(d) : [];
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" id="ogr" required>' + ogrenciSecenekleri(ogrId, !!d) + '</select></label>' +
      '<div class="alan-baslik">Ders durumu *</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="durum" value="yapildi"' + (!dIptal ? ' checked' : '') + '><span>Ders yapıldı</span></label>' +
      '<label class="iptal-sec"><input type="radio" name="durum" value="iptal"' + (dIptal ? ' checked' : '') + '><span>İptal edildi</span></label></div>' +
      '<div id="iptalAlan" hidden><div class="ipucu notr">İptal edilen ders ücrete yazılmaz ve ders sayısına eklenmez; raporda iptal olarak görünür.</div>' +
      '<div id="iptalTarihYer"></div>' + sesliAlan('Not (isteğe bağlı)', 'iptalNot', d ? d.iptalNot || '' : '') + '</div>' +
      '<div id="yapildiAlan"><div id="oncekiYer"></div>' +
      '<div class="alan-baslik">Ücreti aldım mı? *</div><div class="secenekler dikey" style="margin-bottom:14px">' +
      ['hayir', 'nakit', 'havale'].map(function (v) {
        return '<label><input type="radio" name="odeme" value="' + v + '" required' + (d && d.odeme === v ? ' checked' : '') + '><span>' + H.ODEME_ETIKET[v] + '</span></label>';
      }).join('') + '</div>' +
      sesliAlan('İşlenen konu', 'konu', d ? d.konu : '') +
      sesliAlan('Kaldığım yer / sonraki derste', 'kaldigimYer', d ? d.kaldigimYer : '') +
      sesliAlan('Ödev / not', 'odev', d ? d.odev : '', true) +
      '<div class="alan-baslik">Öğrenci nasıldı? (birden fazla seçebilirsiniz)</div><div class="tikler" id="tikler">' +
      H.TIKLER.map(function (t) {
        return '<label class="' + (t.olumlu ? 'olumlu' : 'olumsuz') + '"><input type="checkbox" name="tik" value="' + t.k + '"' + (seciliTik.indexOf(t.k) >= 0 ? ' checked' : '') + '><span>' + esc(t.ad) + '</span></label>';
      }).join('') + '</div>' +
      sesliAlan('🔒 Ders notum (sadece ben görürüm)', 'ozelNot', d ? d.ozelNot || '' : '', true) +
      '<details' + (d && !dIptal ? ' open' : '') + ' id="ayrinti"><summary>Tarih, ders sayısı, ücret</summary>' +
      '<div id="tarihYer"><label class="alan" id="tarihAlan"><span>Tarih <b id="gunAdi"></b></span><input type="date" name="tarih" id="tarih" required value="' + esc(d ? d.tarih : H.bugun()) + '"></label></div>' +
      '<label class="alan"><span>Ders sayısı</span><input type="number" name="dersSayisi" id="dersSayisi" inputmode="decimal" step="any" min="0" required value="' + esc(d && !dIptal ? d.dersSayisi : 1) + '"></label>' +
      '<label class="alan"><span>Birim ücret (₺)</span><input type="number" name="birimUcret" id="birimUcret" inputmode="decimal" step="any" min="0" required value="' + esc(d && !dIptal ? d.birimUcret : '') + '"></label>' +
      '<div class="bilgi">Tutar: <b id="tutar">—</b></div></details></div>' +
      '<button class="buton" type="submit" id="kaydet" style="margin-top:10px">Kaydet</button>' +
      (d && !dIptal ? '<a class="buton ikincil" style="margin-top:10px" href="#/mesaj/' + esc(d.ogrenciId) + '?tur=ders&ders=' + esc(d.id) + '">💬 Bilgilendirme gönder</a>' : '') +
      (d ? '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Kaydı sil</button>' : '') +
      '</form>';
    var f = document.getElementById('f');
    var secim = document.getElementById('ogr'), birim = document.getElementById('birimUcret'), adet = document.getElementById('dersSayisi'), tarih = document.getElementById('tarih');
    var birimElleDegisti = !!d && !dIptal;
    var onceki = null;
    function iptalSecili() { return f.elements.durum.value === 'iptal'; }
    function tutarYaz() { document.getElementById('tutar').textContent = H.formatTL(H.tutarHesapla(adet.value, birim.value)); }
    function gunYaz() { document.getElementById('gunAdi').textContent = tarih.value ? '· ' + H.gunAdi(tarih.value) : ''; }
    function durumDegisti() {
      var ip = iptalSecili(), ya = document.getElementById('yapildiAlan'), ia = document.getElementById('iptalAlan');
      // Tarih alanı tek; görünen bölüme taşınır
      (ip ? document.getElementById('iptalTarihYer') : document.getElementById('tarihYer')).appendChild(document.getElementById('tarihAlan'));
      ya.hidden = ip; ia.hidden = !ip;
      ya.querySelectorAll('input, textarea, select').forEach(function (x) { x.disabled = ip; });
      ia.querySelectorAll('input, textarea').forEach(function (x) { x.disabled = !ip; });
      tarih.disabled = false;
    }
    function ogrenciDegisti() {
      var o = ogrenciBul(secim.value);
      if (o && !birimElleDegisti) birim.value = o.ucret;
      onceki = !o ? null : (d && d.ogrenciId === o.id ? H.oncekiDers(d, db.dersler) : H.sonDers(o.id, db.dersler.filter(function (x) { return !d || x.id !== d.id; })));
      var h = '';
      if (onceki) {
        h += '<div class="ipucu"><b>Önceki ders (' + esc(H.formatTarih(onceki.tarih)) + '):</b> ' + esc(onceki.kaldigimYer || onceki.konu || '—') +
          (onceki.kaldigimYer ? '<button type="button" class="buton kucuk ikincil" id="devam" style="margin-top:8px;width:100%">Kaldığım yerden devam ettik</button>' : '') + '</div>';
        if (onceki.odev) {
          h += '<div class="alan-baslik">Önceki ödev: ' + esc(onceki.odev) + '</div><div class="secenekler" style="margin-bottom:14px">' +
            ['yapti', 'kismen', 'yapmadi'].map(function (v) {
              return '<label><input type="radio" name="oncekiOdev" value="' + v + '"' + (onceki.odevDurum === v ? ' checked' : '') + '><span>' + H.ODEV_ETIKET[v] + '</span></label>';
            }).join('') + '</div>';
        }
      } else if (o) h = '<div class="bilgi">Bu öğrencinin ilk dersi.</div>';
      document.getElementById('oncekiYer').innerHTML = h;
      var dv = document.getElementById('devam');
      if (dv) dv.addEventListener('click', function () { f.elements.konu.value = onceki.kaldigimYer; f.elements.kaldigimYer.focus(); });
      if (iptalSecili()) document.getElementById('oncekiYer').querySelectorAll('input').forEach(function (x) { x.disabled = true; });
      tutarYaz();
    }
    secim.addEventListener('change', ogrenciDegisti);
    birim.addEventListener('input', function () { birimElleDegisti = true; tutarYaz(); });
    adet.addEventListener('input', tutarYaz);
    tarih.addEventListener('change', gunYaz);
    f.querySelectorAll('input[name=durum]').forEach(function (x) { x.addEventListener('change', function () { durumDegisti(); ogrenciDegisti(); }); });
    ogrenciDegisti(); durumDegisti(); gunYaz();
    sesBagla(f);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f), ip = iptalSecili(), kayit;
      if (ip) {
        kayit = Object.assign({}, d || {}, {
          id: yeniId, tarih: tarih.value, ogrenciId: fd.get('ogrenciId'), durum: 'iptal', dersSayisi: 0, birimUcret: 0, tutar: 0, odeme: '',
          konu: '', kaldigimYer: '', odev: '', odevDurum: '', tikler: '', ozelNot: '', iptalNot: String(fd.get('iptalNot') || '').trim()
        });
      } else {
        var ds = sayi(fd.get('dersSayisi')), bu = sayi(fd.get('birimUcret'));
        kayit = Object.assign({}, d || {}, {
          id: yeniId, tarih: tarih.value, ogrenciId: fd.get('ogrenciId'), durum: 'yapildi', dersSayisi: ds, birimUcret: bu, tutar: H.tutarHesapla(ds, bu),
          odeme: fd.get('odeme'), konu: fd.get('konu').trim(), kaldigimYer: fd.get('kaldigimYer').trim(), odev: fd.get('odev').trim(),
          tikler: fd.getAll('tik').join(','), ozelNot: fd.get('ozelNot').trim(), iptalNot: ''
        });
      }
      if (!gelecekOnay(kayit.tarih, 'kayıt')) { b.disabled = false; return; }
      if (!d && db.dersler.some(function (x) { return x.ogrenciId === kayit.ogrenciId && x.tarih === kayit.tarih; }) &&
        !confirm(H.formatTarih(kayit.tarih) + ' tarihinde bu öğrenciye zaten bir ders kaydı var.\n\nYine de kaydedilsin mi?')) { b.disabled = false; return; }
      var od = fd.get('oncekiOdev');
      if (!ip && onceki && od && od !== onceki.odevDurum) opKaydet('ders', Object.assign({}, onceki, { odevDurum: od }));
      kaydetKayit('ders', kayit, d);
      location.hash = '#/ogrenci/' + kayit.ogrenciId + (d || ip ? '' : '?yeni=' + kayit.id);
    });
    if (d) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu ders kaydı silinsin mi?\n' + H.formatTarih(d.tarih) + ' · ' + (dIptal ? 'İptal edildi' : H.formatTL(d.tutar)))) return;
      silKayit('ders', d.id);
      location.hash = '#/ogrenci/' + d.ogrenciId;
    });
  }

  /* ---------------- Ödeme formu ---------------- */
  function ekranOdemeFormu(el, id, q) {
    var p = id ? db.odemeler.find(function (x) { return x.id === id; }) : null;
    if (id && !p) { location.hash = '#/'; return; }
    var ogrId = p ? p.ogrenciId : (q.ogr || '');
    baslikCiz(p ? 'Ödemeyi düzenle' : 'Ödeme ekle', p ? '#/ogrenci/' + p.ogrenciId : (ogrId ? '#/ogrenci/' + ogrId : '#/ekle'));
    if (!db.ogrenciler.length) { el.innerHTML = '<div class="kart bos">Önce bir öğrenci ekleyin.<br><br><a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a></div>'; return; }
    var yeniId = p ? p.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" id="ogr" required>' + ogrenciSecenekleri(ogrId, true) + '</select></label>' +
      '<div id="borcBilgi"></div>' +
      '<label class="alan"><span>Tutar (₺) *</span><input type="number" name="tutar" id="tutar" inputmode="decimal" step="any" min="0.01" required value="' + esc(p ? p.tutar : '') + '"></label>' +
      '<div class="alan-baslik">Nasıl alındı? *</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="yontem" value="nakit" required' + (!p || p.yontem !== 'havale' ? ' checked' : '') + '><span>Elden</span></label>' +
      '<label><input type="radio" name="yontem" value="havale"' + (p && p.yontem === 'havale' ? ' checked' : '') + '><span>EFT</span></label></div>' +
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
      if (!p && db.odemeler.some(function (x) { return x.ogrenciId === kayit.ogrenciId && x.tarih === kayit.tarih && Number(x.tutar) === kayit.tutar; }) &&
        !confirm(H.formatTarih(kayit.tarih) + ' tarihinde bu öğrenciye aynı tutarda (' + H.formatTL(kayit.tutar) + ') bir ödeme zaten var.\n\nYine de kaydedilsin mi?')) { b.disabled = false; return; }
      if (!gelecekOnay(kayit.tarih, 'ödeme')) { b.disabled = false; return; }
      kaydetKayit('odeme', kayit, p);
      location.hash = '#/ogrenci/' + kayit.ogrenciId;
    });
    if (p) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu ödeme kaydı silinsin mi?\n' + H.formatTarih(p.tarih) + ' · ' + H.formatTL(p.tutar))) return;
      silKayit('odeme', p.id);
      location.hash = '#/ogrenci/' + p.ogrenciId;
    });
  }

  /* ---------------- Deneme formu ---------------- */
  function ekranDenemeFormu(el, id, q) {
    var p = id ? db.denemeler.find(function (x) { return x.id === id; }) : null;
    if (id && !p) { location.hash = '#/'; return; }
    var ogrId = p ? p.ogrenciId : (q.ogr || '');
    baslikCiz(p ? 'Denemeyi düzenle' : 'Deneme ekle', ogrId ? '#/ogrenci/' + ogrId : '#/ozel');
    var yeniId = p ? p.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" required>' + ogrenciSecenekleri(ogrId, true) + '</select></label>' +
      '<label class="alan"><span>Sınav adı *</span><input type="text" name="ad" required value="' + esc(p ? p.ad : '') + '" placeholder="ör. LGS Deneme 3, 2. yazılı" autocomplete="off"></label>' +
      '<div class="iki"><label class="alan"><span>Net</span><input type="number" name="net" inputmode="decimal" step="any" value="' + esc(p ? p.net : '') + '"></label>' +
      '<label class="alan"><span>Puan</span><input type="number" name="puan" inputmode="decimal" step="any" value="' + esc(p ? p.puan : '') + '"></label></div>' +
      '<label class="alan"><span>Tarih</span><input type="date" name="tarih" required value="' + esc(p ? p.tarih : H.bugun()) + '"></label>' +
      '<label class="alan"><span>Not</span><input type="text" name="not" value="' + esc(p ? p.not : '') + '" autocomplete="off"></label>' +
      '<button class="buton" type="submit" id="kaydet">Kaydet</button>' +
      (p ? '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Denemeyi sil</button>' : '') + '</form>';
    var f = document.getElementById('f');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f);
      var kayit = Object.assign({}, p || {}, {
        id: yeniId, tarih: fd.get('tarih'), ogrenciId: fd.get('ogrenciId'), ad: fd.get('ad').trim(),
        net: String(fd.get('net')).trim(), puan: String(fd.get('puan')).trim(), not: fd.get('not').trim()
      });
      kaydetKayit('deneme', kayit, p);
      location.hash = '#/ogrenci/' + kayit.ogrenciId;
    });
    if (p) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu deneme kaydı silinsin mi?\n' + p.ad)) return;
      silKayit('deneme', p.id);
      location.hash = '#/ogrenci/' + p.ogrenciId;
    });
  }

  /* ---------------- Mesaj (3 kalıp + ders özeti) ---------------- */
  function ekranMesaj(el, ogrId, q) {
    var o = ogrenciBul(ogrId);
    if (!o) { location.hash = '#/ozel'; return; }
    baslikCiz('Mesaj · ' + o.ad, '#/ogrenci/' + o.id);
    var dersler = db.dersler.filter(function (d) { return d.ogrenciId === o.id && !H.iptalMi(d); }).sort(function (a, b) { return H.siralaAnahtar(a) < H.siralaAnahtar(b) ? 1 : -1; });
    var aylar = {}; aylar[H.bugun().slice(0, 7)] = true;
    db.dersler.forEach(function (d) { if (d.ogrenciId === o.id) aylar[d.tarih.slice(0, 7)] = true; });
    db.odemeler.forEach(function (x) { if (x.ogrenciId === o.id) aylar[x.tarih.slice(0, 7)] = true; });
    var ayListe = Object.keys(aylar).sort().reverse();
    var TURLER = [['odeme', 'Ödemeler ve yapılan dersler', 'Aylık döküm: dersler, ödenen, kalan borç'], ['rapor', 'Rapor', 'Denemeler ve derslerde işlenen konular'],
      ['tutum', 'Dikkat ve tutum 🔒', 'Tarih tarih işaretledikleriniz. Yalnızca siz seçerseniz gider.'], ['ders', 'Ders özeti', 'Tek bir dersin konusu, ödevi, sonraki ders']];
    var tur = q.tur === 'ay' ? 'odeme' : (q.tur || 'odeme');
    if (!TURLER.some(function (t) { return t[0] === tur; }) || (tur === 'ders' && !dersler.length)) tur = 'odeme';
    var vt = veliTel(o), ot = o.ogrenciTel || '';
    el.innerHTML = '<div class="kart"><div class="alan-baslik">Mesaj türü</div><div class="tur-sec">' +
      TURLER.map(function (t) {
        return '<label><input type="radio" name="tur" value="' + t[0] + '"' + (t[0] === tur ? ' checked' : '') + (t[0] === 'ders' && !dersler.length ? ' disabled' : '') + '><span><b>' + t[1] + '</b><i>' + t[2] + '</i></span></label>';
      }).join('') + '</div>' +
      '<label class="alan" id="dersSec"><span>Ders</span><select id="ders">' + dersler.slice(0, 15).map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === q.ders ? ' selected' : '') + '>' + esc(H.formatTarih(d.tarih)) + (d.konu ? ' · ' + esc(d.konu) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="alan" id="aySec"><span>Ay</span><select id="ay">' + ayListe.map(function (a) {
        return '<option value="' + a + '"' + (a === q.ay ? ' selected' : '') + '>' + esc(H.ayAdi(a)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="alan" id="donemSec"><span>Dönem</span><select id="donem">' + donemSecenekleri(q.donem || 'yil') + '</select></label>' +
      '<div class="kontrol" id="notSec"><label><input type="checkbox" id="notDahil"> 🔒 Ders notlarımı da ekle</label></div>' +
      '<div class="alan-baslik">Kime?</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="alici" value="veli"' + (vt || !ot ? ' checked' : '') + '><span>Veli' + (vt ? '' : ' (numara yok)') + '</span></label>' +
      '<label><input type="radio" name="alici" value="ogrenci"' + (!vt && ot ? ' checked' : '') + '><span>Öğrenci' + (ot ? '' : ' (numara yok)') + '</span></label></div>' +
      '<label class="alan"><span>Mesaj (göndermeden önce düzeltebilirsiniz)</span><textarea id="metin" style="min-height:230px"></textarea></label>' +
      '<button class="buton yesil" id="wa">💬 WhatsApp\'ta aç</button>' +
      '<button class="buton ikincil" id="kopyala" style="margin-top:10px">Metni kopyala</button>' +
      '<div class="bilgi" style="margin-top:10px">Numara kayıtlı değilse WhatsApp açılınca kişiyi kendiniz seçersiniz. Mesaj siz göndermeden kimseye gitmez.</div></div>';
    function sec(ad) { var r = el.querySelector('input[name=' + ad + ']:checked'); return r ? r.value : ''; }
    function uret() {
      var t = sec('tur'), alici = sec('alici');
      document.getElementById('dersSec').hidden = t !== 'ders';
      document.getElementById('aySec').hidden = t !== 'odeme';
      document.getElementById('donemSec').hidden = t !== 'rapor' && t !== 'tutum';
      document.getElementById('notSec').hidden = t !== 'tutum';
      var m, dn = donemBul(document.getElementById('donem').value);
      if (t === 'ders') {
        var d = dersler.find(function (x) { return x.id === document.getElementById('ders').value; }) || dersler[0];
        m = H.dersMesaji(o, d, alici, H.oncekiDers(d, db.dersler));
      } else if (t === 'rapor') m = H.raporMetni(o, H.ogrenciRaporu(o.id, db, dn.bas, dn.bit), dn.kisa, alici);
      else if (t === 'tutum') m = H.tutumMetni(o, H.ogrenciRaporu(o.id, db, dn.bas, dn.bit), dn.kisa, document.getElementById('notDahil').checked);
      else m = H.dokumMetni(o, document.getElementById('ay').value, db.dersler, db.odemeler);
      document.getElementById('metin').value = m;
    }
    el.querySelectorAll('input[name=tur], input[name=alici], #ders, #ay, #donem, #notDahil').forEach(function (x) { x.addEventListener('change', uret); });
    uret();
    document.getElementById('wa').addEventListener('click', function () {
      var tel = H.telefonUluslararasi(sec('alici') === 'ogrenci' ? ot : vt);
      var url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(document.getElementById('metin').value);
      window.__sonWa = url;
      window.open(url, '_blank', 'noopener');
    });
    document.getElementById('kopyala').addEventListener('click', function () {
      var ta = document.getElementById('metin');
      var tamam = function () { bildir('Kopyalandı ✓', 'basari'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(tamam, function () { ta.select(); document.execCommand('copy'); tamam(); });
      else { ta.select(); document.execCommand('copy'); tamam(); }
    });
  }

  /* ---------------- Raporlar: Genel | Öğrenciler ---------------- */
  var raporYil = null, raporOgr = '', raporDonem = 'yil', konuTum = false;
  function ekranRapor(el, sekme, q) {
    baslikCiz('Raporlar');
    el.innerHTML = sekmeCubugu([['#/rapor', 'Genel', 'genel'], ['#/rapor/ogrenci', 'Öğrenciler', 'ogrenci']], sekme) + '<div id="sekme"></div>';
    if (sekme === 'ogrenci') { if (q && q.ogr) { raporOgr = q.ogr; konuTum = false; } sekmeRaporOgrenci(document.getElementById('sekme')); }
    else sekmeRapor(document.getElementById('sekme'));
  }
  function cubuk(ad, sag, oran, sinif) {
    return '<div class="cubuk-satir"><div class="cubuk-ust"><b>' + ad + '</b><span>' + sag + '</span></div><div class="cubuk' + (sinif ? ' ' + sinif : '') + '"><div style="width:' + Math.max(2, Math.round(100 * oran)) + '%"></div></div></div>';
  }
  function tikDagilimi(t) {
    if (!t.liste.length) return '<div class="bos">Bu dönemde işaretlenmiş ders yok.</div>';
    return '<div class="bilgi">' + t.kayit + ' ders kaydının ' + t.isaretli + ' tanesinde işaretleme yapılmış.</div>' +
      t.liste.map(function (x) { return cubuk(esc(x.ad), x.adet + ' ders', x.adet / (t.isaretli || 1), x.olumlu ? 'yesil' : 'kirmizi'); }).join('');
  }

  function sekmeRapor(el) {
    var bugun = H.bugun();
    var yillar = H.egitimYillari(db, bugun);
    if (raporYil === null || yillar.indexOf(raporYil) < 0) raporYil = yillar[0];
    var r = H.rapor(raporYil, db, bugun);
    var html = '<label class="alan"><span>Eğitim yılı (1 Eylül – 31 Ağustos)</span><select id="yil">' + yillar.map(function (y) {
      return '<option value="' + y + '"' + (y === raporYil ? ' selected' : '') + '>' + y + '–' + (y + 1) + '</option>'; }).join('') + '</select></label>';
    html += '<div class="kart"><h2>Ay ay</h2><div class="tablo-sar"><table class="tablo" id="ayTablo"><thead><tr><th>Ay</th><th>Ders</th><th>İptal</th><th>Öğr.</th><th>Kazanılan</th><th>Tahsil</th></tr></thead><tbody>';
    r.aylar.forEach(function (a) {
      html += '<tr><td>' + esc(H.AYLAR[+a.ay.slice(5, 7) - 1]) + '</td><td>' + H.formatSayi(a.dersSayisi) + '</td><td>' + a.iptal + '</td><td>' + a.ogrenciSayisi + '</td><td>' + esc(H.formatTL(a.kazanilan)) + '</td><td>' + esc(H.formatTL(a.tahsil)) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Toplam</td><td>' + H.formatSayi(r.toplam.dersSayisi) + '</td><td>' + r.toplam.iptal + '</td><td>' + r.toplam.ogrenciSayisi + '</td><td>' + esc(H.formatTL(r.toplam.kazanilan)) + '</td><td>' + esc(H.formatTL(r.toplam.tahsil)) + '</td></tr></tfoot></table></div>' +
      '<div class="bilgi" style="margin-bottom:0"><b>Kazanılan:</b> o ay yapılan derslerin ücreti. <b>Tahsil:</b> o ay elinize geçen para; önceki ayın dersinin parası sonraki ay gelebilir, bu yüzden iki sütun aynı ayda eşit olmayabilir.</div></div>';
    html += '<div class="kart"><h2>Sınıflara göre</h2>';
    if (!r.siniflar.length) html += '<div class="bos">Bu yıl ders kaydı yok.</div>';
    var enCok = Math.max.apply(null, r.siniflar.map(function (s) { return s.kazanilan; }).concat([1]));
    r.siniflar.forEach(function (s) { html += cubuk(esc(s.sinif), s.ogrenciSayisi + ' öğrenci · ' + H.formatSayi(s.dersSayisi) + ' ders · ' + esc(H.formatTL(s.kazanilan)), s.kazanilan / enCok); });
    html += '</div>';
    html += '<div class="kart" id="tikGenel"><h2>Derslerde öğrenci durumu</h2>' + tikDagilimi(r.tikler) + '</div>';
    if (r.denemeler.length) {
      html += '<div class="kart"><h2>Denemeler</h2><div class="tablo-sar"><table class="tablo" id="denTablo"><thead><tr><th>Öğrenci</th><th>Adet</th><th>İlk net</th><th>Son net</th><th>Ort.</th></tr></thead><tbody>';
      var nf = function (n) { return n === null ? '—' : H.formatSayi(n); };
      r.denemeler.forEach(function (d) {
        html += '<tr><td>' + esc(d.ogrenci.ad) + '</td><td>' + d.adet + '</td><td>' + nf(d.ilkNet) + '</td><td>' + nf(d.sonNet) + '</td><td>' + nf(d.ortNet) + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    el.innerHTML = html;
    document.getElementById('yil').addEventListener('change', function (e) { raporYil = +e.target.value; sekmeRapor(el); });
  }

  function sekmeRaporOgrenci(el) {
    var liste = db.ogrenciler.slice().sort(adSirala);
    if (!liste.length) { el.innerHTML = '<div class="kart bos">Henüz öğrenci yok.</div>'; return; }
    if (!raporOgr || !ogrenciBul(raporOgr)) raporOgr = (aktifOgrenciler()[0] || liste[0]).id;
    var o = ogrenciBul(raporOgr), dn = donemBul(raporDonem);
    var r = H.ogrenciRaporu(o.id, db, dn.bas, dn.bit), z = r.ozet;
    var html = '<label class="alan"><span>Öğrenci</span><select id="rOgr">' + liste.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === o.id ? ' selected' : '') + '>' + esc(x.ad) + (x.durum === 'pasif' ? ' (pasif)' : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="alan"><span>Dönem</span><select id="rDonem">' + donemSecenekleri(dn.k) + '</select></label>';
    html += '<div class="kart" id="rOzet"><div class="ozet"><div><div class="deger">' + H.formatSayi(z.yapilan) + '</div><div class="etiket">ders yapıldı</div></div>' +
      '<div><div class="deger">' + z.iptal + '</div><div class="etiket">iptal</div></div>' +
      '<div><div class="deger ' + (z.borc > 0 ? 'borc' : z.borc < 0 ? 'avans' : '') + '">' + esc(H.formatTL(Math.abs(z.borc))) + '</div><div class="etiket">' + (z.borc < 0 ? 'avans' : 'borç') + '</div></div></div></div>';
    html += '<div class="kart" id="rKonular"><h2>İşlenen konular</h2>';
    if (!r.konular.length) html += '<div class="bos">Bu dönemde konu yazılmamış.</div>';
    else {
      var kl = r.konular.slice().reverse(), gizli = !konuTum && kl.length > 5 ? kl.length - 5 : 0;
      (gizli ? kl.slice(0, 5) : kl).forEach(function (k) { html += '<div class="konu-satir"><span>' + esc(H.formatTarih(k.tarih).slice(0, 5)) + '</span>' + esc(k.konu) + '</div>'; });
      if (gizli) html += '<button class="buton kucuk ikincil" id="konuTum" style="margin-top:8px">+ ' + gizli + ' ders daha (tümünü göster)</button>';
    }
    html += '</div>';
    html += '<div class="kart" id="rDenemeler"><h2>Denemeler</h2>' + (r.denemeler.length ? denemeGruplariHtml(r.denemeler) +
      r.denemeler.map(function (g) { return g.sinavlar.map(function (d) {
        var n = H.sayiVeyaBos(d.net), pu = H.sayiVeyaBos(d.puan);
        return '<div class="konu-satir"><span>' + esc(H.formatTarih(d.tarih).slice(0, 5)) + '</span>' + esc(d.ad) + (n !== null ? ' · <b>' + H.formatSayi(n) + ' net</b>' : '') + (pu !== null ? ' · ' + H.formatSayi(pu) + ' puan' : '') + '</div>'; }).join(''); }).join('')
      : '<div class="bos">Bu dönemde deneme kaydı yok.</div>') + '</div>';
    html += '<div class="kart" id="rTutum"><h2>Dikkat ve tutum</h2>' + tikDagilimi(r.tikler) +
      (r.odev.verilen ? '<div class="bilgi" style="margin-bottom:0"><b>Ödev:</b> ' + r.odev.verilen + ' kez verildi → ' + r.odev.yapti + ' yaptı, ' + r.odev.kismen + ' kısmen, ' + r.odev.yapmadi + ' yapmadı' +
        (r.odev.verilen - r.odev.yapti - r.odev.kismen - r.odev.yapmadi > 0 ? ', ' + (r.odev.verilen - r.odev.yapti - r.odev.kismen - r.odev.yapmadi) + ' işaretlenmedi' : '') + '.</div>' : '') + '</div>';
    if (r.notlar.length) {
      html += '<div class="kart" id="rNotlar"><h2>🔒 Ders notlarım</h2>';
      r.notlar.slice().reverse().forEach(function (n) { html += '<div class="konu-satir"><span>' + esc(H.formatTarih(n.tarih).slice(0, 5)) + '</span>' + esc(n.not) + '</div>'; });
      html += '</div>';
    }
    if (r.iptaller.length) {
      html += '<div class="kart" id="rIptal"><h2>İptal edilen dersler</h2>';
      r.iptaller.slice().reverse().forEach(function (n) { html += '<div class="konu-satir"><span>' + esc(H.formatTarih(n.tarih).slice(0, 5)) + '</span>' + (n.not ? esc(n.not) : '<i>not yok</i>') + '</div>'; });
      html += '</div>';
    }
    html += '<a class="buton" id="mesajHazirla" href="#/mesaj/' + esc(o.id) + '?tur=rapor&donem=' + dn.k + '">💬 Veliye mesaj hazırla</a>' +
      '<a class="buton ikincil" style="margin-top:10px" href="#/ogrenci/' + esc(o.id) + '">Öğrenci kartına git</a>';
    el.innerHTML = html;
    document.getElementById('rOgr').addEventListener('change', function (e) { raporOgr = e.target.value; konuTum = false; sekmeRaporOgrenci(el); });
    document.getElementById('rDonem').addEventListener('change', function (e) { raporDonem = e.target.value; konuTum = false; sekmeRaporOgrenci(el); });
    var kt = document.getElementById('konuTum'); if (kt) kt.addEventListener('click', function () { konuTum = true; sekmeRaporOgrenci(el); });
  }

  /* ---------------- Diğer (sekmeli) ---------------- */
  var SEKMELER = [['alacak', 'Alacaklar'], ['muhasebe', 'Muhasebe'], ['son', 'Son işlemler'], ['yedek', 'Yedek'], ['ayarlar', 'Ayarlar']];
  function ekranDiger(el, sekme, q) {
    baslikCiz('Diğer');
    if (!SEKMELER.some(function (s) { return s[0] === sekme; })) sekme = 'alacak';
    el.innerHTML = sekmeCubugu(SEKMELER.map(function (s) { return ['#/diger/' + s[0], s[1], s[0]]; }), sekme) + '<div id="sekme"></div>';
    var ic = document.getElementById('sekme');
    var akt = el.querySelector('.sekmeler a.aktif'); if (akt && akt.scrollIntoView) akt.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (sekme === 'alacak') sekmeAlacak(ic);
    else if (sekme === 'muhasebe') sekmeMuhasebe(ic);
    else if (sekme === 'son') sekmeSon(ic);
    else if (sekme === 'yedek') sekmeYedek(ic);
    else sekmeAyarlar(ic);
  }

  function sekmeAlacak(el) {
    var t = H.toplamlar(db.ogrenciler, db.dersler, db.odemeler);
    var borclular = H.borclular(db.ogrenciler, db.dersler, db.odemeler);
    var avanslilar = db.ogrenciler.map(function (o) { return { ogrenci: o, b: H.bakiye(o.id, db.dersler, db.odemeler) }; })
      .filter(function (x) { return x.b.borc < 0; }).sort(function (a, b) { return a.b.borc - b.b.borc; });
    var html = '<div class="kart"><div class="ozet iki-sutun">' +
      '<div><div class="deger borc" id="topAlacak">' + esc(H.formatTL(t.alacak)) + '</div><div class="etiket">toplam alacak</div></div>' +
      '<div><div class="deger avans" id="topAvans">' + esc(H.formatTL(t.avans)) + '</div><div class="etiket">toplam avans</div></div></div></div>';
    html += '<div class="kart" id="borclular"><h2>Borçlu öğrenciler</h2>';
    if (!borclular.length) html += '<div class="bos">Borçlu öğrenci yok 🎉</div>';
    borclular.forEach(function (b) {
      var z = H.ogrenciOzeti(b.ogrenci.id, db);
      html += '<a class="satir" href="#/ogrenci/' + esc(b.ogrenci.id) + '"><div class="sol"><div class="ad">' + esc(b.ogrenci.ad) +
        (b.ogrenci.durum === 'pasif' ? ' <span class="rozet pasif">pasif</span>' : '') + '</div><div class="alt">' + esc(b.ogrenci.sinif) + ' · son ödeme ' + (z.sonOdeme ? esc(H.formatTarih(z.sonOdeme)) : 'yok') + '</div></div>' +
        '<div class="sag">' + bakiyeHtml(b.borc, true) + '</div></a>';
    });
    html += '</div>';
    if (avanslilar.length) {
      html += '<div class="kart" id="avanslilar"><h2>Peşin ödeyenler (avans)</h2>';
      avanslilar.forEach(function (x) {
        html += '<a class="satir" href="#/ogrenci/' + esc(x.ogrenci.id) + '"><div class="sol"><div class="ad">' + esc(x.ogrenci.ad) + '</div><div class="alt">' + esc(x.ogrenci.sinif) + '</div></div><div class="sag">' + bakiyeHtml(x.b.borc, true) + '</div></a>';
      });
      html += '</div>';
    }
    el.innerHTML = html;
  }

  var muhDonem = 'ay', muhBas = '', muhBit = '';
  function sekmeMuhasebe(el) {
    var ozel = { k: 'ozel', ad: 'Tarih aralığı seç…' };
    var dn = muhDonem === 'ozel' ? { k: 'ozel', bas: muhBas || null, bit: muhBit || null,
      kisa: (muhBas ? H.formatTarih(muhBas) : '…') + ' – ' + (muhBit ? H.formatTarih(muhBit) : '…') } : donemBul(muhDonem);
    var m = H.muhasebe(db, dn.bas, dn.bit);
    var html = '<label class="alan"><span>Dönem</span><select id="mDonem">' + donemSecenekleri(dn.k, [ozel]) + '</select></label>';
    if (dn.k === 'ozel') html += '<div class="iki"><label class="alan"><span>Başlangıç</span><input type="date" id="mBas" value="' + esc(muhBas) + '"></label><label class="alan"><span>Bitiş</span><input type="date" id="mBit" value="' + esc(muhBit) + '"></label></div>';
    var satir = function (e, d, sinif, id) { return '<div class="ozet-satir"><span>' + e + '</span><b' + (sinif ? ' class="' + sinif + '"' : '') + (id ? ' id="' + id + '"' : '') + '>' + d + '</b></div>'; };
    html += '<div class="kart" id="muhOzet"><h2>Dönem toplamları</h2>' +
      satir('Kazanılan', esc(H.formatTL(m.kazanilan)), '', 'mKazanilan') +
      satir('Tahsil edilen', esc(H.formatTL(m.tahsil)), 'avans', 'mTahsil') +
      satir('<span class="girinti">elden</span>', esc(H.formatTL(m.elden))) +
      satir('<span class="girinti">EFT</span>', esc(H.formatTL(m.eft))) +
      satir('Yapılan ders', H.formatSayi(m.dersSayisi), '', 'mDers') +
      satir('İptal edilen ders', String(m.iptal), '', 'mIptal') +
      satir('Ortalama ders ücreti', m.dersSayisi ? esc(H.formatTL(m.ortUcret)) : '—') +
      '<div class="bilgi" style="margin:10px 0 0"><b>Kazanılan:</b> bu dönemde yapılan derslerin ücreti. <b>Tahsil edilen:</b> bu dönemde elinize geçen para (önceki dönemin dersi için gelen ödeme de buraya yazılır). İkisi aynı dönemde eşit olmak zorunda değildir.</div></div>';
    html += '<div class="kart"><h2>Bugünkü durum</h2>' +
      satir('Toplam alacak', esc(H.formatTL(m.alacak)), 'borc', 'mAlacak') + satir('Toplam avans (peşin alınan)', esc(H.formatTL(m.avans)), 'avans', 'mAvans') +
      '<div class="bilgi" style="margin:10px 0 0">Alacak ve avans dönemden bağımsızdır; bugüne kadarki bütün kayıtlardan hesaplanır.</div></div>';
    html += '<div class="kart"><h2>Öğrenci öğrenci</h2>';
    if (!m.ogrenciler.length) html += '<div class="bos">Bu dönemde kayıt yok.</div>';
    else {
      html += '<div class="tablo-sar"><table class="tablo" id="muhTablo"><thead><tr><th>Öğrenci</th><th>Ders</th><th>İptal</th><th>Ücret</th><th>Ödenen</th><th>Bugünkü borç</th></tr></thead><tbody>';
      m.ogrenciler.forEach(function (x) {
        html += '<tr><td>' + esc(x.ogrenci.ad) + '</td><td>' + H.formatSayi(x.dersSayisi) + '</td><td>' + x.iptal + '</td><td>' + esc(H.formatTL(x.kazanilan)) + '</td><td>' + esc(H.formatTL(x.odenen)) + '</td><td>' + bakiyeHtml(x.borc, true).replace('0 ₺', '0 ₺') + '</td></tr>';
      });
      html += '</tbody></table></div><div class="bilgi" style="margin:8px 0 0">Borç sütununda yeşil tutar avanstır.</div>';
    }
    html += '</div><button class="buton ikincil" id="mExcel">⬇ Bu dökümü Excel\'e aktar</button>';
    el.innerHTML = html;
    document.getElementById('mDonem').addEventListener('change', function (e) { muhDonem = e.target.value; sekmeMuhasebe(el); });
    if (dn.k === 'ozel') {
      document.getElementById('mBas').addEventListener('change', function (e) { muhBas = e.target.value; sekmeMuhasebe(el); });
      document.getElementById('mBit').addEventListener('change', function (e) { muhBit = e.target.value; sekmeMuhasebe(el); });
    }
    document.getElementById('mExcel').addEventListener('click', function () {
      try { xlsxIndir(H.muhasebeSayfalari(db, dn.bas, dn.bit, dn.k === 'tum' ? 'Tüm zamanlar' : dn.kisa), 'hse-muhasebe-' + H.bugun() + '.xlsx'); bildir('Excel indirildi ✓', 'basari'); }
      catch (e) { bildir('Excel oluşturulamadı: ' + e.message, 'hata'); }
    });
  }

  function kayitOzeti(tip, k) {
    if (tip === 'ogrenci') return k.sinif + ' · ' + H.formatTL(k.ucret) + '/ders';
    if (tip === 'ders' && H.iptalMi(k)) return H.formatTarih(k.tarih) + ' · İptal edildi' + (k.iptalNot ? ' · ' + k.iptalNot : '');
    if (tip === 'ders') return H.formatTarih(k.tarih) + ' · ' + H.formatTL(k.tutar) + ' · ' + (H.ODEME_ETIKET[k.odeme] || '') + (k.konu ? ' · ' + k.konu : '');
    if (tip === 'odeme') return H.formatTarih(k.tarih) + ' · ' + H.formatTL(k.tutar) + ' · ' + (H.YONTEM_ETIKET[k.yontem] || '');
    var n = H.sayiVeyaBos(k.net);
    return H.formatTarih(k.tarih) + ' · ' + k.ad + (n !== null ? ' · ' + H.formatSayi(n) + ' net' : '');
  }
  function kayitOgrAdi(tip, k) {
    if (tip === 'ogrenci') return k.ad;
    var o = ogrenciBul(k.ogrenciId);
    if (o) return o.ad;
    var s = silinenBul('ogrenci', k.ogrenciId);
    return s ? s.veri.ad + ' (silinmiş)' : '(silinmiş öğrenci)';
  }

  function sekmeSon(el) {
    var liste = H.sonIslemler(db, 50);
    var TUR = { eklendi: 'eklendi', duzenlendi: 'düzenlendi', silindi: 'silindi' };
    var html = '<div class="bilgi">Son 50 işlem. Yanlış girilen kaydı buradan düzeltebilir ya da silebilir, silineni geri getirebilirsiniz.</div><div class="kart" id="sonListe">';
    if (!liste.length) html += '<div class="bos">Henüz işlem yok.</div>';
    liste.forEach(function (i, n) {
      var duz = i.tip === 'ogrenci' ? '#/ogrenci/' + i.kayit.id + '/duzenle' : '#/' + i.tip + '/' + i.kayit.id;
      html += '<div class="islem' + (i.tur === 'silindi' ? ' silinmis' : '') + '"><div class="ad">' + H.TIP_ETIKET[i.tip] + ' ' + TUR[i.tur] + ' · ' + esc(kayitOgrAdi(i.tip, i.kayit)) + '</div>' +
        '<div class="alt sarili">' + esc(kayitOzeti(i.tip, i.kayit)) + '</div><div class="islem-alt"><span class="alt">' + esc(saat(i.zaman)) + '</span><span class="islem-btn">' +
        (i.tur === 'silindi'
          ? '<button class="buton kucuk ikincil" data-geri="' + n + '">↩ Geri getir</button>'
          : '<a class="buton kucuk ikincil" href="' + esc(duz) + '">Düzenle</a><button class="buton kucuk tehlike" data-sil="' + n + '">Sil</button>') +
        '</span></div></div>';
    });
    el.innerHTML = html + '</div>';
    el.querySelectorAll('[data-geri]').forEach(function (b) { b.addEventListener('click', function () { geriGetir(liste[+b.getAttribute('data-geri')].silinen); }); });
    el.querySelectorAll('[data-sil]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = liste[+b.getAttribute('data-sil')];
        if (i.tip === 'ogrenci') { if (ogrenciSilOnay(i.kayit)) ogrenciSil(i.kayit).then(ciz); return; }
        if (!confirm(H.TIP_ETIKET[i.tip] + ' kaydı silinsin mi?\n' + kayitOgrAdi(i.tip, i.kayit) + ' · ' + kayitOzeti(i.tip, i.kayit))) return;
        silKayit(i.tip, i.kayit.id).then(ciz);
        ciz();
      });
    });
  }

  function yedekBayt() { return window.Yedek.xlsx(H.yedekSayfalari(db)); }
  function sekmeYedek(el) {
    el.innerHTML = '<div class="kart"><h2>Excel yedeği</h2><div class="bilgi">Bütün veriler tek bir Excel dosyası olarak telefona iner: Öğrenciler, Dersler, Ödemeler, Denemeler ve Aylık özet sayfaları. Dosya telefonda oluşturulur, hiçbir yere gönderilmez.</div>' +
      '<div class="bilgi">Öğrenci: ' + db.ogrenciler.length + ' · Ders: ' + db.dersler.length + ' · Ödeme: ' + db.odemeler.length + ' · Deneme: ' + db.denemeler.length + '</div>' +
      '<div class="bilgi" id="sonYedek">Bu telefonda son yedek: <b>' + (ayar.sonYedek ? esc(new Date(ayar.sonYedek).toLocaleString('tr-TR')) : 'henüz alınmadı') + '</b></div>' +
      '<button class="buton" id="indir">⬇ Excel\'e indir</button></div>' +
      '<div class="kart"><h2>Asıl kayıt</h2><div class="bilgi">Verilerin aslı Google hesabınızdaki "Ders Takip" e-tablosunda durur ve Google tarafından saklanır. Bu indirme, elinizde ayrıca bir kopya bulunsun diye.</div></div>';
    document.getElementById('indir').addEventListener('click', function () {
      try {
        xlsxIndir(H.yedekSayfalari(db), 'hse-ders-takip-yedek-' + H.bugun() + '.xlsx');
        ayar.sonYedek = Date.now(); yaz(K.ayar, ayar);
        bildir('Yedek indirildi ✓', 'basari');
        sekmeYedek(el);
      } catch (e) { bildir('Yedek oluşturulamadı: ' + e.message, 'hata'); }
    });
  }

  function sekmeAyarlar(el) {
    el.innerHTML = '<form class="kart" id="f"><h2>Bağlantı</h2>' +
      '<label class="alan"><span>Web uygulaması adresi (Apps Script)</span><input type="url" name="url" value="' + esc(ayar.url) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label class="alan"><span>Şifre (e-tablodaki "Ayarlar" sayfası, B1 hücresi)</span><input type="password" name="key" id="key" value="' + esc(ayar.key) + '" autocomplete="off"></label>' +
      '<div class="kontrol"><label><input type="checkbox" id="goster"> Şifreyi göster</label></div>' +
      '<button class="buton" type="submit" id="kaydet">Kaydet ve bağlantıyı test et</button></form>' +
      '<div class="kart"><h2>Durum</h2><div class="bilgi">Bekleyen kayıt: <b>' + outbox.length + '</b>' +
      (db.sonSenk ? '<br>Son eşitleme: ' + esc(new Date(db.sonSenk).toLocaleString('tr-TR')) : '') +
      (sonHata ? '<br>Son hata: <span class="borc">' + esc(sonHata) + '</span>' : '') +
      '<br>Öğrenci: ' + db.ogrenciler.length + ' · Ders: ' + db.dersler.length + ' · Ödeme: ' + db.odemeler.length + ' · Deneme: ' + db.denemeler.length + '</div>' +
      '<button class="buton ikincil" id="senk">Şimdi eşitle</button></div>' +
      '<form class="kart" id="sf"><h2>Şifreyi değiştir</h2><div class="bilgi">Kolay yazabileceğiniz ama tahmin edilmesi zor bir şifre seçin; en az 8 karakter (ör. üç-dört kelimelik bir söz). Değiştirince diğer telefonda da yeni şifreyi girmeniz gerekir.</div>' +
      '<label class="alan"><span>Yeni şifre</span><input type="text" name="yeni" minlength="8" required autocomplete="off" autocapitalize="off"></label>' +
      '<label class="alan"><span>Yeni şifre (tekrar)</span><input type="text" name="yeni2" minlength="8" required autocomplete="off" autocapitalize="off"></label>' +
      '<button class="buton ikincil" type="submit" id="sifreKaydet">Şifreyi değiştir</button></form>' +
      '<div class="kart"><h2>Ana ekrana ekleme</h2><div class="bilgi"><b>Android (Chrome):</b> sağ üst ⋮ menü → "Ana ekrana ekle" / "Uygulamayı yükle".<br><b>iPhone (Safari):</b> alttaki Paylaş düğmesi → "Ana Ekrana Ekle".</div></div>' +
      '<div class="kart"><h2>Tehlikeli bölge</h2><div class="bilgi">Bu telefondaki kopyayı siler ve sunucudan yeniden indirir. Henüz gönderilmemiş kayıtlar varsa kaybolur.</div>' +
      '<button class="buton tehlike" id="sifirla">Yerel verileri sıfırla</button></div>' +
      '<div class="ortala bilgi">HSE Ders Takip ' + SURUM + '</div>';
    var f = document.getElementById('f');
    document.getElementById('goster').addEventListener('change', function (e) { document.getElementById('key').type = e.target.checked ? 'text' : 'password'; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      ayar = Object.assign({}, ayar, { url: fd.get('url').trim(), key: fd.get('key').trim(), yetkiHatasi: false });
      yaz(K.ayar, ayar);
      var b = document.getElementById('kaydet'); b.disabled = true; b.textContent = 'Test ediliyor…';
      senk(true).then(function (r) {
        if (r.ok) bildir('Bağlantı başarılı ✓', 'basari');
        else bildir(r.neden === 'yetkisiz' ? 'Şifre yanlış.' : 'Bağlantı kurulamadı: ' + (r.mesaj || r.neden), 'hata');
        ciz();
      });
    });
    document.getElementById('senk').addEventListener('click', function () {
      senk(true).then(function (r) { bildir(r.ok ? 'Eşitlendi ✓' : 'Eşitlenemedi: ' + (r.mesaj || r.neden), r.ok ? 'basari' : 'hata');  ciz(); });
    });
    var sf = document.getElementById('sf');
    sf.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(sf), yeni = fd.get('yeni').trim();
      if (yeni.length < 8) { bildir('Şifre en az 8 karakter olmalı.', 'hata'); return; }
      if (yeni !== fd.get('yeni2').trim()) { bildir('İki şifre aynı değil.', 'hata'); return; }
      if (!ayar.url || !ayar.key) { bildir('Önce bağlantıyı kurun.', 'hata'); return; }
      var b = document.getElementById('sifreKaydet'); b.disabled = true;
      istek({ islem: 'sifreDegistir', yeni: yeni }).then(function () {
        ayar.key = yeni; ayar.yetkiHatasi = false; yaz(K.ayar, ayar);
        bildir('Şifre değiştirildi ✓ Diğer telefonda da yenisini girin.', 'basari');
        ciz();
      }, function (err) {
        b.disabled = false;
        bildir(err.yetkisiz ? 'Mevcut şifre yanlış; önce üstteki bağlantıyı düzeltin.' : 'Şifre değiştirilemedi: ' + (err.message || 'bağlantı yok') + '. İnternet gerekir.', 'hata');
      });
    });
    document.getElementById('sifirla').addEventListener('click', function () {
      if (!confirm('Bu telefondaki veriler silinip sunucudan yeniden indirilecek.' + (outbox.length ? '\n\nDİKKAT: Gönderilmemiş ' + outbox.length + ' kayıt kaybolacak!' : '') + '\n\nDevam edilsin mi?')) return;
      db = bosDb(); outbox = []; kalici();
      senk(true).then(ciz);
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
  window.__DT = { senk: senk, yedekBayt: yedekBayt, durum: function () { return { db: db, outbox: outbox, ayar: ayar }; } };
})();
