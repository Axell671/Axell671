// ============================================================
// Tap To Translate — front-end логика
// Чистая статика для GitHub Pages. Бэкенд не нужен.
// ============================================================
(function () {
  "use strict";

  // ---------- DOM ----------
  const $src     = document.getElementById("srcText");
  const $dst     = document.getElementById("dstText");
  const $prov    = document.getElementById("provider");
  const $srcLang = document.getElementById("srcLang");
  const $dstLang = document.getElementById("dstLang");
  const $reverse = document.getElementById("reverse");
  const $clear   = document.getElementById("clearSrc");
  const $copySrc = document.getElementById("copySrc");
  const $copyDst = document.getElementById("copyDst");
  const $status  = document.getElementById("status");
  const $counter = document.getElementById("srcCounter");
  const $badge   = document.getElementById("provBadge");
  const $hint     = document.getElementById("hint");
  const $tooltip = document.getElementById("tooltip");

  // ---------- Состояние ----------
  let debounceTimer = null;
  let lastReqId = 0;
  let cache = new Map(); // key = `${provider}|${src}|${dst}|${text}`
  const DEBOUNCE_MS = 1000;

  // ============================================================
  //  ПРОВАЙДЕРЫ
  // ============================================================

  // ---- Google Translate (free endpoint без ключа) ----
  // Используется интерфейсом translate.google.com.
  async function translateGoogle(text, src, dst) {
    const srcParam = src === "auto" ? "auto" : src;
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx"
      + "&sl=" + encodeURIComponent(srcParam)
      + "&tl=" + encodeURIComponent(dst)
      + "&dt=t&q=" + encodeURIComponent(text);

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("Google: HTTP " + res.status);
    const data = await res.json();

    if (!data || !data[0]) return { text: "", detected: "" };
    let out = "";
    for (let i = 0; i < data[0].length; i++) {
      if (data[0][i] && data[0][i][0]) out += data[0][i][0];
    }
    const detected = data[2] ? String(data[2]) : "";
    return { text: out, detected: detected };
  }

  // ---- MyMemory Translation API (бесплатно, без ключа) ----
  // Документация: mymemory.translated.net/doc/spec.php
  // Лимиты: ~5000 слов/день на IP (без email-регистрации), 50000 с email.
  async function translateMyMemory(text, src, dst) {
    // MyMemory требует конкретный источник, в 'auto' не работает как обычный src.
    // Обход: если src=auto, задаём langpair как "Autodetect|<dst>" — поддержано.
    const langpair = (src === "auto" ? "Autodetect" : src) + "|" + dst;
    const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) +
                "&langpair=" + encodeURIComponent(langpair);

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("MyMemory: HTTP " + res.status);
    const data = await res.json();

    // { responseData: { translatedText, detectedLanguage, ... }, responseStatus: 200, ... }
    if (!data || !data.responseData) return { text: "", detected: "" };
    if (data.responseStatus !== 200 && data.responseStatus !== 403) {
      // 403 — иногда.MyMemory возвращает,но всё-равно с переводом
      throw new Error("MyMemory: статус " + (data.responseDetails || data.responseStatus));
    }
    let out = data.responseData.translatedText || "";
    // Иногда при rate-limit в translatedText попадает служебное "MYMEMORY WARNING"
    if (typeof out === "string" && out.indexOf("MYMEMORY WARNING") === 0) {
      throw new Error("MyMemory: " + out.split("\n")[0]);
    }
    const detected = data.responseData.detectedLanguage || "";
    // detected у MyMemory имеет формат "en" или "en-GB" — упростим
    const detectedShort = detected.split("-")[0].toLowerCase();
    return { text: out, detected: detectedShort };
  }

  // ---- Диспетчер провайдера ----
  async function translate(provider, text, src, dst) {
    if (provider === "google")   return translateGoogle(text, src, dst);
    if (provider === "mymemory") return translateMyMemory(text, src, dst);
    throw new Error("Провайдер требует API-ключ: " + provider);
  }

  // ============================================================
  //  КЕШ (в памяти, на сессию)
  // ============================================================
  function cacheGet(provider, src, dst, text) {
    return cache.get(provider + "|" + src + "|" + dst + "|" + text);
  }
  function cacheSet(provider, src, dst, text, val) {
    cache.set(provider + "|" + src + "|" + dst + "|" + text, val);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
  }

  // ============================================================
  //  ГЛАВНАЯ ФУНКЦИЯ ПЕРЕВОДА
  // ============================================================
  async function doTranslate() {
    const text = $src.value.trim();
    const provider = $prov.value;
    const src = $srcLang.value;
    const dst = $dstLang.value;

    $counter.textContent = String($src.value.length);

    if (!text) {
      $dst.value = "";
      setStatus("");
      return;
    }
    if (src !== "auto" && src === dst) {
      $dst.value = text;
      setStatus("Исходный и целевой языки совпадают — текст без изменений", "ok");
      return;
    }

    // Проверяем кеш
    const cached = cacheGet(provider, src, dst, text);
    if (cached !== undefined) {
      $dst.value = cached;
      setStatus("Перевод из кеша", "ok");
      return;
    }

    const reqId = ++lastReqId;
    setStatus("Переводим…", "loading");
    try {
      const result = await translate(provider, text, src, dst);
      if (reqId !== lastReqId) return; // устаревший ответ
      $dst.value = result.text;
      cacheSet(provider, src, dst, text, result.text);

      let msg = "Готово";
      if (src === "auto" && result.detected) {
        const lbl = labelFor(result.detected);
        msg = "Определено: " + (lbl || result.detected);
      }
      setStatus(msg, "ok");
    } catch (err) {
      if (reqId !== lastReqId) return;
      console.error("[translate] error:", err);
      $dst.value = "";
      setStatus("Ошибка: " + (err.message || "нет связи"), "error");
    }
  }

  function labelFor(code) {
    if (!window.LANGS) return code;
    for (let i = 0; i < window.LANGS.length; i++) {
      if (window.LANGS[i][0] === code) return window.LANGS[i][1];
    }
    const lower = code.toLowerCase();
    for (let i = 0; i < window.LANGS.length; i++) {
      if (window.LANGS[i][0].toLowerCase() === lower) return window.LANGS[i][1];
    }
    return code;
  }

  // ============================================================
  //  DEBOUNCE
  // ============================================================
  function scheduleTranslate() {
    $counter.textContent = String($src.value.length);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doTranslate, DEBOUNCE_MS);
  }

  // ============================================================
  //  РЕВЕРС ЯЗЫКОВ
  // ============================================================
  function reverseLangs() {
    const s = $srcLang.value;
    const d = $dstLang.value;
    if (s === "auto") {
      flashTooltip("Сначала выберите язык вручную", $reverse, "warn");
      return;
    }
    $srcLang.value = d;
    $dstLang.value = s;
    const tmpText = $src.value;
    $src.value = $dst.value;
    $dst.value = tmpText;
    doTranslate();
  }

  // ============================================================
  //  КОПИРОВАНИЕ + TOOLTIP
  // ============================================================
  async function copyText(text, anchorEl, message) {
    if (!text) {
      flashTooltip("Нечего копировать", anchorEl, "warn");
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      flashTooltip(message, anchorEl, "ok");
    } catch (e) {
      flashTooltip("Не удалось скопировать", anchorEl, "warn");
    }
  }

  function flashTooltip(message, anchorEl, kind) {
    const rect = anchorEl.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top - 4;
    $tooltip.textContent = message;
    $tooltip.style.left = x + "px";
    $tooltip.style.top = y + "px";
    $tooltip.style.background = kind === "warn" ? "#f0a93c" : "var(--green)";
    $tooltip.classList.add("show");
    clearTimeout(flashTooltip._t);
    flashTooltip._t = setTimeout(function () {
      $tooltip.classList.remove("show");
    }, 1600);
  }

  // ============================================================
  //  СТАТУС
  // ============================================================
  function setStatus(text, cls) {
    $status.textContent = text || "";
    $status.className = "status" + (cls ? " " + cls : "");
  }

  // ============================================================
  //  SMENA ПРОВАЙДЕРА — автоперевод заново
  // ============================================================
  function onProviderChange() {
    const v = $prov.value;
    const opt = $prov.options[$prov.selectedIndex];
    let label = opt ? opt.textContent : v;
    $badge.textContent = label;

    // Отключённые провайдеры (требуют ключ) — сообщаем пользователю
    if (opt && opt.dataset.locked === "1") {
      flashTooltip("Этот провайдер требует API-ключ. Доступно: Google и MyMemory.", $prov, "warn");
      // Сразу вернёмся на google,Etat на бесплатное значение
      $prov.value = "google";
      $badge.textContent = "Google";
      return;
    }
    if ($src.value.trim()) doTranslate();
  }

  // ============================================================
  //  ПРИВЯЗКА СОБЫТИЙ
  // ============================================================
  $src.addEventListener("input", scheduleTranslate);
  $prov.addEventListener("change", onProviderChange);
  $srcLang.addEventListener("change", function () {
    if ($src.value.trim()) doTranslate();
  });
  $dstLang.addEventListener("change", function () {
    if ($src.value.trim()) doTranslate();
  });
  $reverse.addEventListener("click", reverseLangs);
  $clear.addEventListener("click", function () {
    $src.value = "";
    $dst.value = "";
    $counter.textContent = "0";
    $src.focus();
    setStatus("");
  });
  $copySrc.addEventListener("click", function () {
    copyText($src.value, $copySrc, "Исходный текст скопирован");
  });
  $copyDst.addEventListener("click", function () {
    copyText($dst.value, $copyDst, "Перевод скопирован");
  });
  $copyDst.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $copyDst.click();
    }
  });

  let hintHidden = false;
  $src.addEventListener("input", function () {
    if (!hintHidden) {
      $hint.style.opacity = "0";
      hintHidden = true;
    }
  });

  $src.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      doTranslate();
    }
  });

  $badge.textContent = $prov.value === "mymemory" ? "MyMemory" : "Google";
})();
