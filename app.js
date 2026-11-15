// Eğlence Merkezi — uygulama mantığı
(function () {
  "use strict";

  const P = window.HAVUZ || [];
  const IDX = {};
  P.forEach(function (x) { IDX[x.id] = x; });

  const KOVA = { abonelik: "Aboneliğin", ucretsiz: "Ücretsiz", diger: "Diğer" };
  const DAY = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const MONTH = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const SRC_LABEL = {
    hbo: "HBO Max", prime: "Prime Video", archive: "Internet Archive", yt: "YouTube",
    gut: "Gutenberg", lv: "LibriVox", pod: "Apple Podcasts", bc: "Bandcamp",
    mc: "Mixcloud", itch: "itch.io"
  };
  const EX = window.EKSTRA || { muzik: [], okuma: [], teknoloji: [] };

  // ---- öğrenme parametreleri ----
  const HALF_LIFE = 45;          // gün cinsinden yarı ömür
  const BOOST = { izle: 1.0, begen: 3.0, gec: -0.6, begenme: -3.0, sonra: -0.4 };
  const EXPLORE = 0.9;           // daha önce gösterilmemiş içeriklere bonus
  const RECENT_WEEKS = 3;        // son N haftanın içeriklerini cezalandır
  const NOISE = 0.5;

  // ---- kalıcılık ----
  const KEY = "em_state_v1";
  let mem = { events: [], weeks: {}, lastVisit: null };
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const o = JSON.parse(raw); if (o && o.events) mem = o; }
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
  }
  function now() { return Date.now(); }

  // ---- tarih yardımcıları ----
  function dayKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }
  function parseDay(k) {
    const p = k.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = (x.getDay() + 6) % 7; // 0 = Pazartesi
    return addDays(x, -wd);
  }
  function isoWeekKey(d) {
    const x = mondayOf(d);
    const thr = addDays(x, 3);
    const year = thr.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = 1 + Math.round(((thr - jan1) / 86400000 - 3 + ((jan1.getDay() + 6) % 7)) / 7);
    return year + "-W" + String(week).padStart(2, "0");
  }

  // ---- öğrenme ağırlıkları ----
  function weights() {
    const w = {}; const t0 = now();
    mem.events.forEach(function (ev) {
      const base = BOOST[ev.a] || 0;
      const days = (t0 - ev.ts) / 86400000;
      const decay = Math.pow(0.5, days / HALF_LIFE);
      let sig;
      if (ev.tag) sig = "t:" + ev.tag;
      else if (ev.src) sig = "s:" + ev.src;
      else return;
      w[sig] = (w[sig] || 0) + base * decay;
    });
    return w;
  }
  function tagAffinity(it, w) {
    let s = 0;
    (it.tags || []).forEach(function (tg) { s += (w["t:" + tg] || 0); });
    const n = (it.tags || []).length || 1;
    return s / Math.sqrt(n);
  }
  function scoreItem(it, w, seen, recent, noise) {
    const tag = tagAffinity(it, w);
    const src = (w["s:" + it.src] || 0) * 0.35;
    let s = tag + src;
    if (seen && !seen[it.id]) s += EXPLORE;
    if (recent && recent[it.id]) s -= 1.6;
    s += (noise() - 0.5) * NOISE;
    return s;
  }
  function seenIds() {
    const seen = {};
    Object.keys(mem.weeks).forEach(function (wk) {
      const days = mem.weeks[wk].days || [];
      days.forEach(function (d) {
        Object.keys(d.picks || {}).forEach(function (k) { seen[d.picks[k]] = true; });
      });
    });
    return seen;
  }
  function recentIds() {
    const r = {};
    const keys = Object.keys(mem.weeks).sort().slice(-RECENT_WEEKS);
    keys.forEach(function (wk) {
      (mem.weeks[wk].days || []).forEach(function (d) {
        Object.keys(d.picks || {}).forEach(function (k) { r[d.picks[k]] = true; });
      });
    });
    return r;
  }

  // ---- hafta planı ----
  function pick(bucket, w, used, noise) {
    const seen = seenIds(); const recent = recentIds();
    const cands = P.filter(function (x) { return x.b === bucket && !used.has(x.id); });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return scoreItem(b, w, seen, recent, noise) - scoreItem(a, w, seen, recent, noise); });
    return cands[0].id;
  }
  function fillDays(week, from, w, used) {
    let n = 0;
    const noise = seeded(week.k);
    for (let d = from; d < 7; d++) {
      const day = week.days[d];
      if (!day) continue;
      ["abonelik", "ucretsiz", "diger"].forEach(function (bk) {
        if (day.picks[bk]) return;
        const id = pick(bk, w, used, noise);
        if (id) { day.picks[bk] = id; used.add(id); n++; }
      });
    }
    return n;
  }
  function seeded(seed) {
    let a = 0x9E3779B9 ^ (hashCode(seed) >>> 0);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return h;
  }
  function ensureWeek() {
    const today = new Date();
    const monday = mondayOf(today);
    const wk = isoWeekKey(today);
    if (!mem.weeks[wk]) {
      const days = [];
      for (let d = 0; d < 7; d++) { days.push({ date: dayKey(addDays(monday, d)), picks: {} }); }
      mem.weeks[wk] = { k: wk, days: days, rejected: [] };
      const w = weights();
      fillDays(mem.weeks[wk], 0, w, new Set());
      save();
    }
    // eski haftaları buda (son 8 hafta kalsın)
    const cutoff = isoWeekKey(addDays(today, -8 * 7));
    Object.keys(mem.weeks).forEach(function (k) {
      if (k < cutoff) delete mem.weeks[k];
    });
    save();
    return mem.weeks[wk];
  }
  function weekLabel(week) {
    const first = week.days[0] ? parseDay(week.days[0].date) : new Date();
    const last = addDays(first, 6);
    return first.getDate() + " " + MONTH[first.getMonth()] + " – " + last.getDate() + " " + MONTH[last.getMonth()];
  }
  function todayIndex(week) {
    const k = dayKey(new Date());
    for (let i = 0; i < week.days.length; i++) { if (week.days[i].date === k) return i; }
    return 0;
  }

  // ---- URL ----
  function enc(s) { return encodeURIComponent(s); }
  function buildUrl(it) {
    if (it.u) return it.u;
    const q = enc(it.q || it.t);
    switch (it.src) {
      case "hbo": return "https://www.hbomax.com/tr/tr/search?q=" + q;
      case "prime": return "https://www.primevideo.com/region/tr/search?phrase=" + q;
      case "archive": return "https://archive.org/search?query=" + q;
      case "yt": return "https://www.youtube.com/results?search_query=" + q;
      case "gut": return "https://www.gutenberg.org/ebooks/search/?query=" + q;
      case "lv": return "https://librivox.org/search?q=" + q;
      case "pod": return "https://podcasts.apple.com/tr/search?term=" + q;
      case "bc": return "https://bandcamp.com/search?q=" + q;
      case "mc": return "https://www.mixcloud.com/search/?q=" + q;
      case "itch": return "https://itch.io/search?q=" + q;
      default: return "https://www.google.com/search?q=" + q;
    }
  }
  function altUrl(it) {
    if (it.src === "hbo" || it.src === "prime") {
      return "https://www.justwatch.com/tr/ara?q=" + enc(it.q || it.t);
    }
    return null;
  }

  // ---- render ----
  let selected = 0;
  function fmtDur(it) {
    if (it.min && it.min > 0) return "≈ " + it.min + " dk";
    return "okuma/dinleme";
  }
  function likedIds(day, week) {
    const map = {};
    mem.events.forEach(function (ev) {
      if (ev.day === day && ev.a === "begen") map[ev.id] = true;
    });
    (week.rejected || []).forEach(function (id) { map[id] = "no"; });
    return map;
  }
  function reason(it, w) {
    const tags = (it.tags || []).slice();
    let best = null, bestV = -1e9;
    tags.forEach(function (tg) { const v = w["t:" + tg] || 0; if (v > bestV) { bestV = v; best = tg; } });
    const srcV = w["s:" + it.src] || 0;
    if (srcV > bestV) best = SRC_LABEL[it.src] || it.src;
    if (best && bestV > 0.25) return "Sana " + best + " çekici geliyor";
    return "Keşif: henüz göstermedim";
  }
  function cardHTML(it, day, slot, week) {
    if (!it) {
      return '<div class="card empty"><div class="card-k">' + KOVA[slot] +
        '</div><p class="muted">Bu kova için içerik kalmadı — havuzu genişletince düzelir.</p></div>';
    }
    const lk = likedIds(day.date, week);
    const liked = lk[it.id] === true;
    const rej = lk[it.id] === "no";
    const w = weights();
    const alt = altUrl(it);
    const dur = fmtDur(it);
    const srcLabel = SRC_LABEL[it.src] || it.src;
    return '<div class="card' + (liked ? " liked" : "") + (rej ? " rej" : "") + '">' +
      '<div class="card-top"><span class="card-k">' + KOVA[slot] + '</span><span class="card-src">' + srcLabel + '</span></div>' +
      '<div class="card-title">' + esc(it.t) + '</div>' +
      '<div class="card-meta">' + it.k + ' · ' + dur + '</div>' +
      '<div class="tags">' + (it.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("") + '</div>' +
      '<div class="why">' + reason(it, w) + '</div>' +
      '<div class="acts">' +
        '<button class="btn go" data-a="izle" data-day="' + day.date + '" data-id="' + it.id + '">İzle</button>' +
        '<button class="btn yes" data-a="begen" data-day="' + day.date + '" data-id="' + it.id + '"' + (liked ? " disabled" : "") + '>Beğendim</button>' +
        '<button class="btn no" data-a="begenme" data-day="' + day.date + '" data-id="' + it.id + '">Bana göre değil</button>' +
        '<button class="btn later" data-a="sonra" data-day="' + day.date + '" data-id="' + it.id + '">Sonra</button>' +
      '</div>' +
      (alt ? '<div class="alt"><a href="' + alt + '" target="_blank" rel="noopener">Nerede izlenir?</a></div>' : "") +
      '</div>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderHeader(week) {
    document.getElementById("weeklabel").textContent = weekLabel(week) + " · " + week.k;
    document.getElementById("pickcount").textContent = "her gün 3 öneri · 1 abonelik + 1 ücretsiz + 1 diğer";
  }
  function renderWeek(week) {
    const todayK = dayKey(new Date());
    document.getElementById("weekstrip").innerHTML = week.days.map(function (d, i) {
      const dt = parseDay(d.date);
      const cls = "chip" + (i === selected ? " sel" : "") + (d.date === todayK ? " today" : "") + (d.date < todayK ? " past" : "");
      return '<button class="' + cls + '" data-i="' + i + '">' + DAY[i] + "<br><span>" + dt.getDate() + " " + MONTH[dt.getMonth()] + "</span></button>";
    }).join("");
  }
  function renderHero(week) {
    const day = week.days[selected] || week.days[0];
    const todayK = dayKey(new Date());
    const status = day.date === todayK ? "Bugün" : (day.date < todayK ? "Geçmiş gün" : "Yaklaşan");
    document.getElementById("hero").innerHTML =
      '<div class="day-head"><h2>' + DAY[selected] + ' · ' + status + '</h2>' +
      '<span class="muted">' + day.date + '</span></div>' +
      '<div class="cards">' +
        cardHTML(IDX[day.picks.abonelik], day, "abonelik", week) +
        cardHTML(IDX[day.picks.ucretsiz], day, "ucretsiz", week) +
        cardHTML(IDX[day.picks.diger], day, "diger", week) +
      '</div>';
  }
  function renderLearn() {
    const w = weights();
    const pos = [], neg = [];
    Object.keys(w).forEach(function (k) {
      const name = k.indexOf("t:") === 0 ? k.slice(2) : ("kaynak:" + (SRC_LABEL[k.slice(2)] || k.slice(2)));
      (w[k] >= 0 ? pos : neg).push([name, w[k]]);
    });
    pos.sort(function (a, b) { return b[1] - a[1]; });
    neg.sort(function (a, b) { return a[1] - b[1]; });
    const top = pos.slice(0, 6).concat(neg.slice(0, 3));
    const max = Math.max.apply(null, top.map(function (x) { return Math.abs(x[1]); }).concat([1]));
    const bars = top.map(function (x) {
      const pct = Math.round(Math.abs(x[1]) / max * 100);
      return '<div class="bar"><span>' + esc(x[0]) + '</span><span class="track"><span class="fill' + (x[1] < 0 ? " neg" : "") + '" style="width:' + pct + '%"></span></span><b>' + (x[1] >= 0 ? "+" : "") + x[1].toFixed(1) + '</b></div>';
    }).join("") || '<p class="muted">Henüz sinyal yok — İzle / Beğendim / Bana göre değil dedikçe burada belirir.</p>';
    const counts = { izle: 0, begen: 0, begenme: 0, sonra: 0 };
    mem.events.forEach(function (ev) { if (counts[ev.a] != null) counts[ev.a]++; });
    document.getElementById("learn").innerHTML =
      '<div class="note">Öğrenme yerelde: ' + mem.events.length + ' sinyal (izle ' + counts.izle +
      ', beğeni ' + counts.begen + ', ret ' + counts.begenme + ', sonra ' + counts.sonra + '). Hiçbir veri dışarı çıkmaz.</div>' +
      '<div class="bars">' + bars + '</div>';
    document.getElementById("replanBtn").textContent = "Kalan günleri yeniden kur";
  }
  function renderLib() {
    const groups = { abonelik: [], ucretsiz: [], diger: [] };
    P.forEach(function (x) { groups[x.b].push(x); });
    document.getElementById("library").innerHTML = Object.keys(groups).map(function (g) {
      return '<div class="lib-group"><h3>' + KOVA[g] + ' <span class="muted">(' + groups[g].length + ')</span></h3>' +
        groups[g].map(function (x) {
          return '<a class="lib-item" href="' + buildUrl(x) + '" target="_blank" rel="noopener"><span>' + esc(x.t) + '</span><span class="muted">' + (SRC_LABEL[x.src] || x.src) + '</span></a>';
        }).join("") + '</div>';
    }).join("");
  }
  function renderExtras(week) {
    const day = week.days[selected] || week.days[0];
    const dt = parseDay(day.date);
    const doy = dayOfYear(dt);
    const muz = EX.muzik[doy % EX.muzik.length] || { t: "Müzik", q: "music" };
    const oku = EX.okuma[doy % EX.okuma.length] || { t: "Okuma", u: "https://longreads.com" };
    const muzUrl = muz.u || ("https://www.youtube.com/results?search_query=" + enc(muz.q));
    const html =
      '<div class="cards mini">' +
      '<a class="card" href="' + muzUrl + '" target="_blank" rel="noopener">' +
        '<div class="card-top"><span class="card-k">Müzik</span></div>' +
        '<div class="card-title">' + esc(muz.t) + '</div>' +
        '<div class="card-meta">' + esc(muz.s || "YouTube") + '</div>' +
      '</a>' +
      '<a class="card" href="' + oku.u + '" target="_blank" rel="noopener">' +
        '<div class="card-top"><span class="card-k">Okuma</span></div>' +
        '<div class="card-title">' + esc(oku.t) + '</div>' +
        '<div class="card-meta">' + esc(oku.s || "okuma") + '</div>' +
      '</a>' +
      '<div class="card">' +
        '<div class="card-top"><span class="card-k">Teknoloji</span></div>' +
        '<div class="tech-list">' +
        EX.teknoloji.map(function (x) {
          return '<a href="' + x.u + '" target="_blank" rel="noopener"><span>' + esc(x.t) + '</span><span class="muted">' + esc(x.s) + '</span></a>';
        }).join("") +
        '</div>' +
      '</div>' +
      '</div>';
    document.getElementById("extras").innerHTML = html;
  }
  function render(week) {
    renderHeader(week);
    renderWeek(week);
    renderHero(week);
    renderExtras(week);
    renderLearn();
  }

  // ---- etkileşim ----
  function record(a, day, id, it) {
    mem.events.push({ a: a, id: id, day: day, ts: now(), tag: it ? (it.tags || [])[0] : undefined, src: it ? it.src : undefined });
    if (mem.events.length > 4000) mem.events = mem.events.slice(-4000);
    save();
  }
  function refillRest(week, noise) {
    const used = new Set((week.rejected || []).slice());
    week.days.forEach(function (d) { (d.picks && Object.keys(d.picks).forEach(function (k) { used.add(d.picks[k]); })); });
    const w = weights();
    ["abonelik", "ucretsiz", "diger"].forEach(function (bk) {
      for (let d = selected + 1; d < 7; d++) {
        const day = week.days[d];
        if (!day) continue;
        const id = pick(bk, w, used, noise);
        if (id) { day.picks[bk] = id; used.add(id); }
      }
    });
    save();
  }
  function replaceSlot(week, day, slot, id) {
    week.rejected = week.rejected || [];
    if (week.rejected.indexOf(id) < 0) week.rejected.push(id);
    const used = new Set(week.rejected.slice());
    week.days.forEach(function (d) {
      if (d.date === day) { if (d.picks[slot] === id) delete d.picks[slot]; }
      Object.keys(d.picks).forEach(function (k) { used.add(d.picks[k]); });
    });
    const w = weights();
    const noise = seeded(week.k);
    const nid = pick(slot, w, used, noise);
    if (nid) { day.picks[slot] = nid; used.add(nid); }
    refillRest(week, noise);
    save();
  }
  function onCard(a, dayDate, id) {
    const week = ensureWeek();
    const day = week.days.find(function (d) { return d.date === dayDate; });
    if (!day) return;
    const it = IDX[id];
    if (!it) return;
    if (a === "izle") {
      record("izle", dayDate, id, it);
      const u = buildUrl(it);
      const w = window.open(u, "_blank");
      if (w) try { w.opener = null; } catch (e) {}
      renderLearn();
      toast("İlgi işlendi: " + it.t);
      return;
    }
    record(a, dayDate, id, it);
    if (a === "begen") {
      renderHero(week); renderLearn();
      toast("Beğendi işlendi → " + (it.tags || []).join(", ") + " güçleniyor");
      return;
    }
    if (a === "begenme" || a === "sonra") {
      if (dayDate >= dayKey(new Date())) {
        replaceSlot(week, day, "begenme" === a ? slotOf(day, id) : slotOf(day, id), id);
      }
      renderHero(week); renderLearn();
      toast(a === "begenme" ? "Çıkarıldı, yerine yeni öneri geldi" : "Sonraya bırakıldı");
    }
  }
  function slotOf(day, id) {
    let s = null;
    ["abonelik", "ucretsiz", "diger"].forEach(function (bk) { if (day.picks[bk] === id) s = bk; });
    return s;
  }

  // ---- araçlar ----
  function replanRest() {
    const week = ensureWeek();
    ["abonelik", "ucretsiz", "diger"].forEach(function (bk) {
      for (let d = selected + 1; d < 7; d++) { if (week.days[d]) delete week.days[d].picks[bk]; }
    });
    const used = new Set((week.rejected || []).slice());
    week.days.forEach(function (d) {
      if (d && d.picks) Object.keys(d.picks).forEach(function (k) { used.add(d.picks[k]); });
    });
    const noise = seeded(week.k);
    const w = weights();
    ["abonelik", "ucretsiz", "diger"].forEach(function (bk) {
      for (let d = selected + 1; d < 7; d++) {
        const id = pick(bk, w, used, noise);
        if (id) { week.days[d].picks[bk] = id; used.add(id); }
      }
    });
    save();
    render(week);
    toast("Kalan günler yeniden kuruldu");
  }
  function exportIcs() {
    const week = ensureWeek();
    const stamp = now();
    let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Eglence Merkezi//TR\r\nCALSCALE:GREGORIAN\r\n";
    week.days.forEach(function (d) {
      const picks = Object.keys(d.picks).map(function (k) { return IDX[d.picks[k]]; }).filter(Boolean);
      if (!picks.length) return;
      const dt = parseDay(d.date);
      const st = dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, "0") + String(dt.getDate()).padStart(2, "0") + "T200000";
      const end = dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, "0") + String(dt.getDate()).padStart(2, "0") + "T204500";
      const body = picks.map(function (p) { return "• " + p.t + " → " + buildUrl(p); }).join("\\n");
      ics += "BEGIN:VEVENT\r\n";
      ics += "UID:" + week.k + "-" + d.date + "@eglence\r\n";
      ics += "DTSTAMP:" + isoStamp(stamp) + "\r\n";
      ics += "DTSTART:" + st + "\r\nDTEND:" + end + "\r\n";
      ics += "SUMMARY:Eğlence Merkezi — " + DAY[week.days.indexOf(d)] + " önerileri\r\n";
      ics += "DESCRIPTION:" + fold(body) + "\r\n";
      ics += "BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:Öneriler hazır\r\nEND:VALARM\r\n";
      ics += "END:VEVENT\r\n";
    });
    ics += "END:VCALENDAR\r\n";
    download("eglence-" + week.k + ".ics", ics, "text/calendar");
    toast("Takvim dosyası indi — açınca Apple Takvim'e abone olabilirsin");
  }
  function isoStamp(ts) {
    const d = new Date(ts);
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  function fold(s) {
    // iCal satır katlama (75 okteti aşınca). Basit tutuldu.
    const out = [];
    let line = s;
    while (line.length > 68) { out.push(line.slice(0, 68)); line = " " + line.slice(68); }
    out.push(line);
    return out.join("\r\n ");
  }
  function exportJson() {
    const week = ensureWeek();
    const payload = {
      uygulama: "Eglence Merkezi",
      aciklama: "Davranış öğrenme yedeği — yalnızca bu proje için.",
      exportedAt: new Date().toISOString(),
      events: mem.events,
      weeks: mem.weeks,
      weights: weights()
    };
    download("davranis-" + dayKey(new Date()) + ".json", JSON.stringify(payload, null, 2), "application/json");
    toast("Yedek indi: davranis-" + dayKey(new Date()) + ".json");
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type: type + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function importJson(file) {
    const r = new FileReader();
    r.onload = function () {
      try {
        const o = JSON.parse(r.result);
        if (!o || !Array.isArray(o.events)) throw new Error("format");
        const have = {};
        mem.events.forEach(function (e) { have[e.id + "|" + e.ts] = true; });
        o.events.forEach(function (e) { if (!have[e.id + "|" + e.ts]) mem.events.push(e); });
        save();
        render(ensureWeek());
        toast("Yedek yüklendi: " + o.events.length + " sinyal birleştirildi");
      } catch (err) {
        toast("Geçersiz yedek dosyası");
      }
    };
    r.readAsText(file);
  }
  function resetAll() {
    if (!confirm("Tüm öğrenme ve bu haftanın planı silinsin mi?")) return;
    mem = { events: [], weeks: {}, lastVisit: null };
    save();
    selected = 0;
    const week = ensureWeek();
    render(week); renderLib();
    toast("Sıfırlandı — yeniden başlıyoruz");
  }
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "show";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = ""; }, 2600);
  }

  // ---- olay bağlama ----
  function bind() {
    document.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-a]");
      if (btn) {
        onCard(btn.getAttribute("data-a"), btn.getAttribute("data-day"), btn.getAttribute("data-id"));
        return;
      }
      const chip = e.target.closest("[data-i]");
      if (chip) {
        selected = parseInt(chip.getAttribute("data-i"), 10);
        renderHero(ensureWeek());
        renderWeek(ensureWeek());
        return;
      }
      const t = e.target.closest("[data-tool]");
      if (t) {
        const tool = t.getAttribute("data-tool");
        if (tool === "ics") exportIcs();
        else if (tool === "replan") replanRest();
        else if (tool === "export") exportJson();
        else if (tool === "reset") resetAll();
        else if (tool === "import") document.getElementById("file").click();
        return;
      }
    });
    document.getElementById("file").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = "";
    });
  }

  // ---- başlangıç ----
  load();
  const week = ensureWeek();
  selected = todayIndex(week);
  bind();
  render(week);
  renderLib();
})();
