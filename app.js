/* Ders Takip — uygulama (sürüm 2) */
(function () {
  'use strict';
  var H = window.Hesap;
  var SURUM = '2.0.0';
  var SUNUCU_SURUM = 2;

  /* ---------------- Depolama ---------------- */
  var K = { db: 'dt_db', outbox: 'dt_outbox', ayar: 'dt_ayar' };
  function oku(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Depolama hatası', e); } }

  function bosDb() { return { ogrenciler: [], dersler: [], odemeler: [], denemeler: [], silinenler: [], sonSenk: null, sunucuSurum: null }; }
  var db = Object.assign(bosDb(), oku(K.db) || {});
  var outbox = oku(K.outbox) || [];
  var ayar = Object.assign({ url: '', key: '', yetkiHatasi: false }, oku(K.ayar) || {});
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
  function odemeRozet(d) {
    if (d.odeme === 'nakit') return '<span class="rozet nakit">Elden alındı</span>';
    if (d.odeme === 'havale') return '<span class="rozet havale">EFT alındı</span>';
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
      (p[0] === 'ogrenci' && (p[1] === 'yeni' || p[2] === 'duzenle')) || (p[0] === 'diger' && p[1] === 'ayarlar');
  }

  var sonRota = '';
  function ciz() {
    var r = rota();
    var p = r.parca;
    var icerik = document.getElementById('icerik');
    var nav = 'ana';
    if (aktifSes) { try { aktifSes.stop(); } catch (e) {} }
    try {
      if (p.length === 0) { ekranAna(icerik); }
      else if (p[0] === 'ogrenciler') { nav = 'ogrenciler'; ekranOgrenciler(icerik); }
      else if (p[0] === 'ogrenci' && p[1] === 'yeni') { nav = 'ogrenciler'; ekranOgrenciFormu(icerik, null); }
      else if (p[0] === 'ogrenci' && p[2] === 'duzenle') { nav = 'ogrenciler'; ekranOgrenciFormu(icerik, p[1]); }
      else if (p[0] === 'ogrenci' && p[1]) { nav = 'ogrenciler'; ekranOgrenciKarti(icerik, p[1], r.q); }
      else if (p[0] === 'ders') { nav = 'ders'; ekranDersFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'odeme') { nav = 'odeme'; ekranOdemeFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'deneme') { nav = 'ogrenciler'; ekranDenemeFormu(icerik, p[1] === 'yeni' ? null : p[1], r.q); }
      else if (p[0] === 'mesaj' && p[1]) { nav = 'ogrenciler'; ekranMesaj(icerik, p[1], r.q); }
      else if (p[0] === 'diger') { nav = 'diger'; ekranDiger(icerik, p[1] || 'son', r.q); }
      else if (p[0] === 'ayarlar') { location.hash = '#/diger/ayarlar'; return; }
      else { location.hash = '#/'; return; }
    } catch (e) {
      console.error(e);
      icerik.innerHTML = '<div class="kart"><b>Bir hata oluştu:</b> ' + esc(e.message) + '</div>';
    }
    document.querySelectorAll('#alt-menu a').forEach(function (a) { a.classList.toggle('aktif', a.getAttribute('data-nav') === nav); });
    if (location.hash !== sonRota) { window.scrollTo(0, 0); sonRota = location.hash; }
  }

  /* ---------------- Ana sayfa (genel özet) ---------------- */
  function ekranAna(el) {
    baslikCiz('Ders Takip');
    var ay = H.bugun().slice(0, 7);
    var o = H.ayOzeti(ay, db.dersler, db.odemeler);
    var t = H.toplamlar(db.ogrenciler, db.dersler, db.odemeler);
    var borclular = H.borclular(db.ogrenciler, db.dersler, db.odemeler);
    var konusuz = db.dersler.filter(function (d) { return !d.konu; }).sort(function (a, b) { return H.siralaAnahtar(a) < H.siralaAnahtar(b) ? 1 : -1; });
    var html = '';
    if (!ayar.url || !ayar.key) {
      html += '<div class="ipucu"><b>Bağlantı kurulmadı.</b> Girdiğiniz kayıtlar şimdilik yalnızca bu telefonda saklanır. <a href="#/diger/ayarlar">Diğer → Ayarlar</a> ekranından web uygulaması adresini ve şifreyi girin.</div>';
    } else if (ayar.yetkiHatasi) {
      html += '<div class="ipucu"><b>Şifre yanlış.</b> Şifre değiştirildiyse yenisini <a href="#/diger/ayarlar">Diğer → Ayarlar</a> ekranına girin. Kayıtlarınız telefonda bekliyor.</div>';
    } else if (db.sonSenk && db.sunucuSurum && db.sunucuSurum < SUNUCU_SURUM) {
      html += '<div class="ipucu"><b>Google tarafındaki kod eski.</b> Deneme kayıtları ve geri getirme çalışmaz. Kılavuzdaki "Code.gs güncelleme" adımını yapın.</div>';
    }
    html += '<div class="buyuk-butonlar"><a class="buton" href="#/ders/yeni">+ Ders</a><a class="buton yesil" href="#/odeme/yeni">+ Ödeme</a></div>';
    html += '<div class="kart"><h2>' + esc(H.ayAdi(ay)) + '</h2><div class="ozet">' +
      '<div><div class="deger">' + H.formatSayi(o.dersSayisi) + '</div><div class="etiket">ders</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.kazanilan)) + '</div><div class="etiket">kazanılan</div></div>' +
      '<div><div class="deger">' + esc(H.formatTL(o.tahsil)) + '</div><div class="etiket">tahsil edilen</div></div></div></div>';
    html += '<div class="kart"><div class="ozet" style="grid-template-columns:1fr 1fr">' +
      '<div><div class="deger borc">' + esc(H.formatTL(t.alacak)) + '</div><div class="etiket">toplam alacak</div></div>' +
      '<div><div class="deger avans">' + esc(H.formatTL(t.avans)) + '</div><div class="etiket">toplam avans</div></div></div></div>';
    if (konusuz.length) {
      html += '<div class="kart" id="konusuz"><h2>Konusu yazılmamış dersler (' + konusuz.length + ')</h2>';
      konusuz.slice(0, 8).forEach(function (d) {
        var og = ogrenciBul(d.ogrenciId);
        html += '<a class="satir" href="#/ders/' + esc(d.id) + '"><div class="sol"><div class="ad">' + esc(og ? og.ad : '?') + '</div><div class="alt">' + esc(H.formatTarih(d.tarih)) + '</div></div><div class="sag"><span class="rozet">Konuyu yaz ›</span></div></a>';
      });
      html += '</div>';
    }
    html += '<div class="kart" id="borclular"><h2>Borçlu öğrenciler</h2>';
    if (!borclular.length) html += '<div class="bos">Borçlu öğrenci yok 🎉</div>';
    borclular.forEach(function (b) {
      html += '<a class="satir" href="#/ogrenci/' + esc(b.ogrenci.id) + '"><div class="sol"><div class="ad">' + esc(b.ogrenci.ad) +
        (b.ogrenci.durum === 'pasif' ? ' <span class="rozet pasif">pasif</span>' : '') + '</div><div class="alt">' + esc(b.ogrenci.sinif) + '</div></div>' +
        '<div class="sag">' + bakiyeHtml(b.borc, true) + '</div></a>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  /* ---------------- Öğrenciler ---------------- */
  var ogrAra = '', pasifGoster = false;
  function ekranOgrenciler(el) {
    baslikCiz('Öğrenciler');
    var liste = db.ogrenciler.slice().sort(adSirala);
    el.innerHTML = '<input class="arama" type="text" id="ara" placeholder="Ara…" value="' + esc(ogrAra) + '" autocomplete="off">' +
      '<div class="kontrol"><label><input type="checkbox" id="pasifGoster"' + (pasifGoster ? ' checked' : '') + '> Pasifleri göster</label>' +
      '<a class="buton kucuk" href="#/ogrenci/yeni">+ Öğrenci</a></div><div class="kart" id="ogrListe"></div>';
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

  /* ---------------- Öğrenci kartı ---------------- */
  function netGrafik(liste) {
    var p = liste.map(function (d) { return { d: d, n: H.sayiVeyaBos(d.net) }; }).filter(function (x) { return x.n !== null; });
    if (p.length < 2) return '';
    var min = Math.min.apply(null, p.map(function (x) { return x.n; })), max = Math.max.apply(null, p.map(function (x) { return x.n; }));
    var W = 300, Hh = 70, pad = 12, ar = (max - min) || 1;
    var nok = p.map(function (x, i) { return { x: pad + i * (W - 2 * pad) / (p.length - 1), y: Hh - pad - (x.n - min) * (Hh - 2 * pad) / ar }; });
    return '<svg class="grafik" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Net gelişimi"><polyline fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-linejoin="round" points="' +
      nok.map(function (n) { return n.x.toFixed(1) + ',' + n.y.toFixed(1); }).join(' ') + '"/>' +
      nok.map(function (n) { return '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="3.5" fill="#1d4ed8"/>'; }).join('') + '</svg>' +
      '<div class="grafik-alt"><span>İlk: ' + H.formatSayi(p[0].n) + ' net</span><span>Son: ' + H.formatSayi(p[p.length - 1].n) + ' net</span></div>';
  }

  function ekranOgrenciKarti(el, id, q) {
    var o = ogrenciBul(id);
    if (!o) { baslikCiz('Öğrenci', '#/ogrenciler'); el.innerHTML = '<div class="bos">Öğrenci bulunamadı.</div>'; return; }
    baslikCiz(o.ad, '#/ogrenciler');
    var b = H.bakiye(o.id, db.dersler, db.odemeler);
    var son = H.sonDers(o.id, db.dersler);
    var html = '';
    var yeniDers = q && q.yeni ? db.dersler.find(function (d) { return d.id === q.yeni; }) : null;
    if (yeniDers) html += '<div class="kart vurgu" id="yeniDers"><b>Ders kaydedildi.</b> Bu dersin özetini WhatsApp\'tan göndermek ister misiniz?' +
      '<a class="buton yesil kucuk" style="margin-top:10px;width:100%" href="#/mesaj/' + esc(o.id) + '?tur=ders&ders=' + esc(yeniDers.id) + '">💬 Bilgilendirme gönder</a></div>';
    html += '<div class="kart"><div class="bakiye-buyuk">' + bakiyeHtml(b.borc) + '</div>' +
      '<div class="ortala bilgi">' + esc(o.sinif) + ' · ' + esc(H.formatTL(o.ucret)) + '/ders' + (o.durum === 'pasif' ? ' · <span class="rozet pasif">pasif</span>' : '') + '</div>';
    html += telButonlari('Veli', veliTel(o)) + telButonlari('Öğrenci', o.ogrenciTel);
    if (o.not) html += '<div class="bilgi">' + esc(o.not) + '</div>';
    if (son && son.kaldigimYer) html += '<div class="ipucu"><b>Sonraki derste:</b> ' + esc(son.kaldigimYer) + '</div>';
    if (son && son.odev) html += '<div class="bilgi"><b>Son ödev:</b> ' + esc(son.odev) + '</div>';
    html += '<div class="buton-sira"><a class="buton" href="#/ders/yeni?ogr=' + esc(o.id) + '">+ Ders</a><a class="buton yesil" href="#/odeme/yeni?ogr=' + esc(o.id) + '">+ Ödeme</a></div>' +
      '<div class="buton-sira"><a class="buton ikincil kucuk" href="#/mesaj/' + esc(o.id) + '?tur=ay">💬 Mesaj / döküm</a><a class="buton ikincil kucuk" href="#/deneme/yeni?ogr=' + esc(o.id) + '">+ Deneme</a></div>' +
      '<div class="buton-sira"><a class="buton ikincil kucuk" href="#/ogrenci/' + esc(o.id) + '/duzenle">Düzenle</a>' +
      '<button class="buton ikincil kucuk" id="durumDegistir">' + (o.durum === 'pasif' ? 'Aktif yap' : 'Pasif yap') + '</button></div></div>';

    var den = db.denemeler.filter(function (d) { return d.ogrenciId === o.id; }).sort(function (a, b2) { return H.siralaAnahtar(a) < H.siralaAnahtar(b2) ? -1 : 1; });
    if (den.length) {
      html += '<div class="kart" id="denemeler"><h2>Denemeler</h2>' + netGrafik(den);
      den.slice().reverse().forEach(function (d) {
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
      if (s.tip === 'ders') {
        html += '<a class="satir" href="#/ders/' + esc(k.id) + '"><div class="sol"><div class="ad">' + esc(H.formatTarih(k.tarih)) + ' · Ders' + (sayi(k.dersSayisi) !== 1 ? ' ×' + esc(k.dersSayisi) : '') + ' · ' + esc(H.formatTL(k.tutar)) + ' ' + odemeRozet(k) + '</div>' +
          '<div class="alt sarili">' + (k.konu ? esc(k.konu) : '<i>konu yazılmadı</i>') + (k.kaldigimYer ? ' → ' + esc(k.kaldigimYer) : '') +
          (k.odev ? '<br>Ödev: ' + esc(k.odev) + (H.ODEV_ETIKET[k.odevDurum] ? ' <span class="rozet odev-' + esc(k.odevDurum) + '">' + H.ODEV_ETIKET[k.odevDurum] + '</span>' : '') : '') + '</div></div>' +
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
      location.hash = '#/ogrenciler';
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
    baslikCiz(d ? 'Dersi düzenle' : 'Ders ekle', d ? '#/ogrenci/' + d.ogrenciId : (ogrId ? '#/ogrenci/' + ogrId : '#/'));
    if (!db.ogrenciler.length) { el.innerHTML = '<div class="kart bos">Önce bir öğrenci ekleyin.<br><br><a class="buton" href="#/ogrenci/yeni">+ Öğrenci</a></div>'; return; }
    var yeniId = d ? d.id : H.uid();
    el.innerHTML = '<form class="kart" id="f">' +
      '<label class="alan"><span>Öğrenci *</span><select name="ogrenciId" id="ogr" required>' + ogrenciSecenekleri(ogrId, !!d) + '</select></label>' +
      '<div id="oncekiYer"></div>' +
      '<div class="alan-baslik">Ücreti aldım mı? *</div><div class="secenekler dikey" style="margin-bottom:14px">' +
      ['hayir', 'nakit', 'havale'].map(function (v) {
        return '<label><input type="radio" name="odeme" value="' + v + '" required' + (d && d.odeme === v ? ' checked' : '') + '><span>' + H.ODEME_ETIKET[v] + '</span></label>';
      }).join('') + '</div>' +
      sesliAlan('İşlenen konu', 'konu', d ? d.konu : '') +
      sesliAlan('Kaldığım yer / sonraki derste', 'kaldigimYer', d ? d.kaldigimYer : '') +
      sesliAlan('Ödev / not', 'odev', d ? d.odev : '', true) +
      '<details' + (d ? ' open' : '') + '><summary>Tarih, ders sayısı, ücret</summary>' +
      '<label class="alan"><span>Tarih</span><input type="date" name="tarih" required value="' + esc(d ? d.tarih : H.bugun()) + '"></label>' +
      '<label class="alan"><span>Ders sayısı</span><input type="number" name="dersSayisi" id="dersSayisi" inputmode="decimal" step="any" min="0" required value="' + esc(d ? d.dersSayisi : 1) + '"></label>' +
      '<label class="alan"><span>Birim ücret (₺)</span><input type="number" name="birimUcret" id="birimUcret" inputmode="decimal" step="any" min="0" required value="' + esc(d ? d.birimUcret : '') + '"></label>' +
      '<div class="bilgi">Tutar: <b id="tutar">—</b></div></details>' +
      '<button class="buton" type="submit" id="kaydet" style="margin-top:10px">Kaydet</button>' +
      (d ? '<a class="buton ikincil" style="margin-top:10px" href="#/mesaj/' + esc(d.ogrenciId) + '?tur=ders&ders=' + esc(d.id) + '">💬 Bilgilendirme gönder</a>' +
        '<button class="buton tehlike" type="button" id="sil" style="margin-top:10px">Dersi sil</button>' : '') +
      '</form>';
    var f = document.getElementById('f');
    var secim = document.getElementById('ogr'), birim = document.getElementById('birimUcret'), adet = document.getElementById('dersSayisi');
    var birimElleDegisti = !!d;
    var onceki = null;
    function tutarYaz() { document.getElementById('tutar').textContent = H.formatTL(H.tutarHesapla(adet.value, birim.value)); }
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
      tutarYaz();
    }
    secim.addEventListener('change', ogrenciDegisti);
    birim.addEventListener('input', function () { birimElleDegisti = true; tutarYaz(); });
    adet.addEventListener('input', tutarYaz);
    ogrenciDegisti();
    sesBagla(f);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = document.getElementById('kaydet'); if (b.disabled) return; b.disabled = true;
      var fd = new FormData(f);
      var ds = sayi(fd.get('dersSayisi')), bu = sayi(fd.get('birimUcret'));
      var kayit = Object.assign({}, d || {}, {
        id: yeniId, tarih: fd.get('tarih'), ogrenciId: fd.get('ogrenciId'), dersSayisi: ds, birimUcret: bu, tutar: H.tutarHesapla(ds, bu),
        odeme: fd.get('odeme'), konu: fd.get('konu').trim(), kaldigimYer: fd.get('kaldigimYer').trim(), odev: fd.get('odev').trim()
      });
      if (!d && db.dersler.some(function (x) { return x.ogrenciId === kayit.ogrenciId && x.tarih === kayit.tarih; }) &&
        !confirm(H.formatTarih(kayit.tarih) + ' tarihinde bu öğrenciye zaten bir ders kaydı var.\n\nYine de kaydedilsin mi?')) { b.disabled = false; return; }
      var od = fd.get('oncekiOdev');
      if (onceki && od && od !== onceki.odevDurum) opKaydet('ders', Object.assign({}, onceki, { odevDurum: od }));
      kaydetKayit('ders', kayit, d);
      location.hash = '#/ogrenci/' + kayit.ogrenciId + (d ? '' : '?yeni=' + kayit.id);
    });
    if (d) document.getElementById('sil').addEventListener('click', function () {
      if (!confirm('Bu ders kaydı silinsin mi?\n' + H.formatTarih(d.tarih) + ' · ' + H.formatTL(d.tutar))) return;
      silKayit('ders', d.id);
      location.hash = '#/ogrenci/' + d.ogrenciId;
    });
  }

  /* ---------------- Ödeme formu ---------------- */
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
    baslikCiz(p ? 'Denemeyi düzenle' : 'Deneme ekle', ogrId ? '#/ogrenci/' + ogrId : '#/ogrenciler');
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

  /* ---------------- Mesaj (bilgilendirme / aylık döküm) ---------------- */
  function ekranMesaj(el, ogrId, q) {
    var o = ogrenciBul(ogrId);
    if (!o) { location.hash = '#/ogrenciler'; return; }
    baslikCiz('Mesaj · ' + o.ad, '#/ogrenci/' + o.id);
    var dersler = db.dersler.filter(function (d) { return d.ogrenciId === o.id; }).sort(function (a, b) { return H.siralaAnahtar(a) < H.siralaAnahtar(b) ? 1 : -1; });
    var aylar = {}; aylar[H.bugun().slice(0, 7)] = true;
    dersler.forEach(function (d) { aylar[d.tarih.slice(0, 7)] = true; });
    db.odemeler.forEach(function (x) { if (x.ogrenciId === o.id) aylar[x.tarih.slice(0, 7)] = true; });
    var ayListe = Object.keys(aylar).sort().reverse();
    var tur = q.tur === 'ders' && dersler.length ? 'ders' : 'ay';
    var vt = veliTel(o), ot = o.ogrenciTel || '';
    el.innerHTML = '<div class="kart"><div class="alan-baslik">Mesaj türü</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="tur" value="ders"' + (tur === 'ders' ? ' checked' : '') + (dersler.length ? '' : ' disabled') + '><span>Ders özeti</span></label>' +
      '<label><input type="radio" name="tur" value="ay"' + (tur === 'ay' ? ' checked' : '') + '><span>Aylık döküm</span></label></div>' +
      '<label class="alan" id="dersSec"><span>Ders</span><select id="ders">' + dersler.slice(0, 15).map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === q.ders ? ' selected' : '') + '>' + esc(H.formatTarih(d.tarih)) + (d.konu ? ' · ' + esc(d.konu) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="alan" id="aySec"><span>Ay</span><select id="ay">' + ayListe.map(function (a) {
        return '<option value="' + a + '"' + (a === q.ay ? ' selected' : '') + '>' + esc(H.ayAdi(a)) + '</option>'; }).join('') + '</select></label>' +
      '<div class="alan-baslik">Kime?</div><div class="secenekler" style="margin-bottom:14px">' +
      '<label><input type="radio" name="alici" value="veli"' + (vt || !ot ? ' checked' : '') + '><span>Veli' + (vt ? '' : ' (numara yok)') + '</span></label>' +
      '<label><input type="radio" name="alici" value="ogrenci"' + (!vt && ot ? ' checked' : '') + '><span>Öğrenci' + (ot ? '' : ' (numara yok)') + '</span></label></div>' +
      '<label class="alan"><span>Mesaj (göndermeden önce düzeltebilirsiniz)</span><textarea id="metin" style="min-height:230px"></textarea></label>' +
      '<button class="buton yesil" id="wa">💬 WhatsApp\'ta aç</button>' +
      '<button class="buton ikincil" id="kopyala" style="margin-top:10px">Metni kopyala</button>' +
      '<div class="bilgi" style="margin-top:10px">Numara kayıtlı değilse WhatsApp açılınca kişiyi kendiniz seçersiniz.</div></div>';
    function sec(ad) { var r = el.querySelector('input[name=' + ad + ']:checked'); return r ? r.value : ''; }
    function uret() {
      var t = sec('tur'), alici = sec('alici');
      document.getElementById('dersSec').hidden = t !== 'ders';
      document.getElementById('aySec').hidden = t !== 'ay';
      var m;
      if (t === 'ders') {
        var d = dersler.find(function (x) { return x.id === document.getElementById('ders').value; }) || dersler[0];
        m = H.dersMesaji(o, d, alici, H.oncekiDers(d, db.dersler));
      } else m = H.dokumMetni(o, document.getElementById('ay').value, db.dersler, db.odemeler);
      document.getElementById('metin').value = m;
    }
    el.querySelectorAll('input[name=tur], input[name=alici], #ders, #ay').forEach(function (x) { x.addEventListener('change', uret); });
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

  /* ---------------- Diğer (sekmeli) ---------------- */
  var SEKMELER = [['son', 'Son işlemler'], ['nerede', 'Nerede kaldık'], ['rapor', 'Raporlar'], ['yedek', 'Yedek'], ['ayarlar', 'Ayarlar']];
  var raporYil = null;
  function ekranDiger(el, sekme, q) {
    baslikCiz('Diğer');
    if (!SEKMELER.some(function (s) { return s[0] === sekme; })) sekme = 'son';
    el.innerHTML = '<div class="sekmeler">' + SEKMELER.map(function (s) {
      return '<a href="#/diger/' + s[0] + '"' + (s[0] === sekme ? ' class="aktif"' : '') + '>' + s[1] + '</a>'; }).join('') + '</div><div id="sekme"></div>';
    var ic = document.getElementById('sekme');
    var akt = el.querySelector('.sekmeler a.aktif'); if (akt && akt.scrollIntoView) akt.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (sekme === 'son') sekmeSon(ic);
    else if (sekme === 'nerede') sekmeNerede(ic);
    else if (sekme === 'rapor') sekmeRapor(ic);
    else if (sekme === 'yedek') sekmeYedek(ic);
    else sekmeAyarlar(ic);
  }

  function kayitOzeti(tip, k) {
    if (tip === 'ogrenci') return k.sinif + ' · ' + H.formatTL(k.ucret) + '/ders';
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

  function sekmeNerede(el) {
    var bugun = H.bugun();
    var liste = H.neredeKaldik(db.ogrenciler, db.dersler, bugun);
    var html = '<div class="bilgi">Aktif öğrenciler; en uzun süredir ders yapılmayan üstte.</div><div class="kart" id="neredeListe">';
    if (!liste.length) html += '<div class="bos">Aktif öğrenci yok.</div>';
    liste.forEach(function (x) {
      var o = x.ogrenci, s = x.son;
      html += '<div class="satir"><a class="sol" href="#/ogrenci/' + esc(o.id) + '" style="text-decoration:none;color:inherit"><div class="ad">' + esc(o.ad) + ' <span class="rozet">' + esc(o.sinif) + '</span></div>' +
        '<div class="alt">' + (s ? 'Son ders: ' + esc(H.formatTarih(s.tarih)) + ' (' + esc(H.kacGunOnce(s.tarih, bugun)) + ')' : 'Henüz ders yapılmadı') + '</div>' +
        (s ? '<div class="alt sarili"><b>Sonraki derste:</b> ' + esc(s.kaldigimYer || '—') + (s.odev ? '<br><b>Ödev:</b> ' + esc(s.odev) : '') + '</div>' : '') +
        '</a><div class="sag"><a class="buton kucuk" href="#/ders/yeni?ogr=' + esc(o.id) + '">+ Ders</a></div></div>';
    });
    el.innerHTML = html + '</div>';
  }

  function sekmeRapor(el) {
    var bugun = H.bugun();
    var yillar = H.egitimYillari(db, bugun);
    if (raporYil === null || yillar.indexOf(raporYil) < 0) raporYil = yillar[0];
    var r = H.rapor(raporYil, db, bugun);
    var html = '<label class="alan"><span>Eğitim yılı (1 Eylül – 31 Ağustos)</span><select id="yil">' + yillar.map(function (y) {
      return '<option value="' + y + '"' + (y === raporYil ? ' selected' : '') + '>' + y + '–' + (y + 1) + '</option>'; }).join('') + '</select></label>';
    html += '<div class="kart"><h2>Ay ay</h2><div class="tablo-sar"><table class="tablo" id="ayTablo"><thead><tr><th>Ay</th><th>Ders</th><th>Öğr.</th><th>Kazanılan</th><th>Tahsil</th></tr></thead><tbody>';
    r.aylar.forEach(function (a) {
      html += '<tr><td>' + esc(H.ayAdi(a.ay)) + '</td><td>' + H.formatSayi(a.dersSayisi) + '</td><td>' + a.ogrenciSayisi + '</td><td>' + esc(H.formatTL(a.kazanilan)) + '</td><td>' + esc(H.formatTL(a.tahsil)) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Toplam</td><td>' + H.formatSayi(r.toplam.dersSayisi) + '</td><td>' + r.toplam.ogrenciSayisi + '</td><td>' + esc(H.formatTL(r.toplam.kazanilan)) + '</td><td>' + esc(H.formatTL(r.toplam.tahsil)) + '</td></tr></tfoot></table></div></div>';
    html += '<div class="kart"><h2>Sınıflara göre</h2>';
    if (!r.siniflar.length) html += '<div class="bos">Bu yıl ders kaydı yok.</div>';
    var enCok = Math.max.apply(null, r.siniflar.map(function (s) { return s.kazanilan; }).concat([1]));
    r.siniflar.forEach(function (s) {
      html += '<div class="cubuk-satir"><div class="cubuk-ust"><b>' + esc(s.sinif) + '</b><span>' + s.ogrenciSayisi + ' öğrenci · ' + H.formatSayi(s.dersSayisi) + ' ders · ' + esc(H.formatTL(s.kazanilan)) + '</span></div>' +
        '<div class="cubuk"><div style="width:' + Math.max(2, Math.round(100 * s.kazanilan / enCok)) + '%"></div></div></div>';
    });
    html += '</div>';
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

  function yedekBayt() { return window.Yedek.xlsx(H.yedekSayfalari(db)); }
  function sekmeYedek(el) {
    el.innerHTML = '<div class="kart"><h2>Excel yedeği</h2><div class="bilgi">Bütün veriler tek bir Excel dosyası olarak telefona iner: Öğrenciler, Dersler, Ödemeler, Denemeler ve Aylık özet sayfaları. Dosya telefonda oluşturulur, hiçbir yere gönderilmez.</div>' +
      '<div class="bilgi">Öğrenci: ' + db.ogrenciler.length + ' · Ders: ' + db.dersler.length + ' · Ödeme: ' + db.odemeler.length + ' · Deneme: ' + db.denemeler.length + '</div>' +
      '<button class="buton" id="indir">⬇ Excel\'e indir</button></div>' +
      '<div class="kart"><h2>Asıl kayıt</h2><div class="bilgi">Verilerin aslı Google hesabınızdaki "Ders Takip" e-tablosunda durur ve Google tarafından saklanır. Bu indirme, elinizde ayrıca bir kopya bulunsun diye.</div></div>';
    document.getElementById('indir').addEventListener('click', function () {
      try {
        var blob = new Blob([yedekBayt()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ders-takip-yedek-' + H.bugun() + '.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        bildir('Yedek indirildi ✓', 'basari');
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
      '<div class="ortala bilgi">Ders Takip ' + SURUM + '</div>';
    var f = document.getElementById('f');
    document.getElementById('goster').addEventListener('change', function (e) { document.getElementById('key').type = e.target.checked ? 'text' : 'password'; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      ayar = { url: fd.get('url').trim(), key: fd.get('key').trim(), yetkiHatasi: false };
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
