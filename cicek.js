/* HSE Ders Takip — sayfa arkasındaki çiçek filigranları (kodla çizilir, dışarıdan resim yüklenmez) */
(function () {
  var GUL = '#A15668', DOLGU = '#F8ECEA', ACIK = '#F0D6D6';
  var S = 'stroke="' + GUL + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
  function g(ic) { return '<g ' + S + ' fill="' + DOLGU + '">' + ic + '</g>'; }
  var C = {
    gul: function () {
      var s = '';
      [-60, 60].forEach(function (a) { s += '<path d="M150,150 C80,100 40,150 20,120 C60,70 120,80 150,150Z" transform="rotate(' + a + ' 150 150) translate(0 20)"/>'; });
      function kat(n, r, pr, rot) { for (var i = 0; i < n; i++) s += '<circle cx="150" cy="' + (150 - r) + '" r="' + pr + '" transform="rotate(' + (rot + i * 360 / n) + ' 150 150)"/>'; }
      kat(7, 92, 56, 0); kat(6, 66, 46, 20); kat(5, 44, 33, 8); kat(4, 24, 22, 30);
      return g(s + '<path d="M150,150 m-2,0 a6,6 0 1,1 8,6 a12,12 0 1,1 -18,-12 a18,18 0 1,1 26,16" fill="none"/>');
    },
    zambak: function () {
      var s = '';
      function petal(a, k) { return '<g transform="rotate(' + a + ' 150 150) translate(150 150) scale(' + k + ') translate(-150 -150)"><path d="M150,150 C112,112 116,52 150,10 C184,52 188,112 150,150Z"/><path d="M150,140 L150,40" fill="none"/></g>'; }
      [0, 120, 240].forEach(function (a) { s += petal(a + 60, .9); });
      [0, 120, 240].forEach(function (a) { s += petal(a, 1.08); });
      for (var i = 0; i < 6; i++) { var a = i * 60 + 30; s += '<g transform="rotate(' + a + ' 150 150)"><path d="M150,150 L150,96" fill="none"/><ellipse cx="150" cy="90" rx="5" ry="11" fill="' + GUL + '"/></g>'; }
      return g(s);
    },
    lale: function () {
      return g('<path d="M150,300 L150,190" fill="none" stroke-width="3"/><path d="M150,300 C100,262 78,222 88,168 C128,198 150,248 150,300Z"/><path d="M150,300 C200,262 222,222 212,168 C172,198 150,248 150,300Z"/>' +
        '<path d="M92,62 C76,122 104,176 150,190 C124,150 116,102 92,62Z"/><path d="M208,62 C224,122 196,176 150,190 C176,150 184,102 208,62Z"/>' +
        '<path d="M150,28 C116,70 114,142 150,190 C186,142 184,70 150,28Z"/><path d="M150,70 L150,150" fill="none"/>');
    },
    papatya: function () {
      var s = '<path d="M150,300 L150,200" fill="none" stroke-width="3"/><path d="M150,290 C110,270 96,240 100,214 C130,226 148,256 150,290Z"/><path d="M150,262 C190,246 204,222 200,200 C170,210 152,232 150,262Z"/>';
      for (var i = 0; i < 18; i++) s += '<ellipse cx="150" cy="84" rx="15" ry="46" transform="rotate(' + (i * 20) + ' 150 150)"/>';
      return g(s + '<circle cx="150" cy="150" r="30" fill="' + ACIK + '"/><circle cx="150" cy="150" r="14" fill="none"/>');
    },
    lavanta: function () {
      var s = '';
      function sap(x0, bukuk, ust, olcek) {
        s += '<path d="M' + x0 + ',300 C' + (x0 - bukuk) + ',230 ' + (x0 + bukuk) + ',150 ' + x0 + ',' + ust + '" fill="none" stroke-width="3"/>';
        for (var i = 0; i < 9; i++) {
          var y = ust + 12 + i * 20 * olcek, k = 1 - i * .04;
          s += '<ellipse cx="' + (x0 - 10 * k) + '" cy="' + y + '" rx="' + (7 * k) + '" ry="' + (13 * k) + '" transform="rotate(-35 ' + (x0 - 10 * k) + ' ' + y + ')"/>' +
            '<ellipse cx="' + (x0 + 10 * k) + '" cy="' + (y + 6) + '" rx="' + (7 * k) + '" ry="' + (13 * k) + '" transform="rotate(35 ' + (x0 + 10 * k) + ' ' + (y + 6) + ')"/>';
        }
        s += '<ellipse cx="' + x0 + '" cy="' + (ust - 4) + '" rx="6" ry="14"/>';
      }
      sap(150, 10, 40, 1); sap(95, 20, 100, .85); sap(205, -20, 90, .88);
      return g(s);
    },
    nilufer: function () {
      var s = '<ellipse cx="70" cy="258" rx="66" ry="15"/><ellipse cx="232" cy="268" rx="58" ry="13"/>';
      function petal(a, len, w) { return '<path d="M150,236 C' + (150 - w) + ',' + (236 - len * .5) + ' ' + (150 - w * .55) + ',' + (236 - len * .86) + ' 150,' + (236 - len) + ' C' + (150 + w * .55) + ',' + (236 - len * .86) + ' ' + (150 + w) + ',' + (236 - len * .5) + ' 150,236Z" transform="rotate(' + a + ' 150 236)"/>'; }
      [-74, 74].forEach(function (a) { s += petal(a, 140, 58); }); [-48, 48].forEach(function (a) { s += petal(a, 170, 50); }); [-22, 22].forEach(function (a) { s += petal(a, 192, 44); });
      return g(s + petal(0, 205, 40));
    }
  };
  window.Cicek = { svg: function (ad) { return '<svg viewBox="0 0 300 300" aria-hidden="true">' + (C[ad] || C.gul)() + '</svg>'; } };
})();
