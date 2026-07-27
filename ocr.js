// ============================================================
//  OCR через Tesseract.js
//  Всё client-side, без ключей. Грузит wasm и traineddata с CDN.
//  Tesseract инициализируется lazily — только при первом клике.
// ============================================================
(function () {
  "use strict";

  const $btn      = document.getElementById("ocrBtn");
  const $file     = document.getElementById("ocrFile");
  const $prog     = document.getElementById("ocrProgress");
  const $lang     = document.getElementById("ocrLang");
  const $srcText  = document.getElementById("srcText");
  const $srcLang  = document.getElementById("srcLang"); // чтобы автодетект включить

  let worker       = null;
  let initPromise  = null;
  let currentLangs = null;  // string вида "rus+eng" — те, что были загружены в worker
  let running      = false;

  // ---------- Прогресс-текст ----------
  function setProgress(text, kind) {
    $prog.textContent = text || "";
    $prog.className = "ocr-progress" + (kind ? " " + kind : "") +
                      (kind === "active" ? " loading" : "");
  }

  // ---------- Ленивая инициализация Tesseract ----------
  // Tesseract.js грузит ~100 КБ worker + ~2 МБ wasm core + traineddata (~2 МБ каждый язык) с CDN.
  async function ensureWorker(langs) {
    // Если worker уже есть и языки совпадают — переиспользуем
    if (worker && currentLangs === langs) return worker;

    // Прогресс-сообщения во время загрузки тазеров
    setProgress("Подготовка OCR-движка… (загрузка около 2 МБ)", "active");

    // Ленивая инициализация — грузим tesseract.js только если библиотека подцепилась
    if (typeof Tesseract === "undefined") {
      throw new Error("Tesseract.js не загрузился с CDN. Проверьте интернет или поставьте библиотеку локально.");
    }

    // Переиспользуем уже инициализированный worker, если меняем только языки
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) { /* старый worker мог уже умереть — ну и ладно */ }
      worker = null;
    }

    // Создаём worker с явными путями к CDN (иначе tesseract будет искать файлы относительно
    // нашей страницы, что на GitHub Pages не сработает).
    worker = await Tesseract.createWorker(langs, 1, {
      // 1 = OEM_LSTM_ONLY — быстрее, точнее для типичных скриншотов
      logger: function (m) {
        if (m.status === "recognizing") {
          const pct = Math.round((m.progress || 0) * 100);
          setProgress("Распознавание: " + pct + "%", "active");
        } else if (m.status === "loading tesseract core") {
          setProgress("Загрузка ядра OCR…", "active");
        } else if (m.status === "initializing tesseract") {
          setProgress("Запуск OCR…", "active");
        } else if (m.status === "loading language traineddata") {
          setProgress("Загрузка словаря " + langs + "…", "active");
        } else if (m.status === "initializing api") {
          setProgress("Подготовка API…", "active");
        }
      },
      // Пути к wasm/worker — tesseract.js v5 сам их разрулит, но укажем для надёжности.
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
      corePath:   "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js",
      langPath:   "https://tessdata.projectnaptha.com/4.0.0",
    });

    currentLangs = langs;
    return worker;
  }

  // ---------- Считаем файл в dataURL ----------
  function fileToDataURL(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload  = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("Не удалось прочитать файл")); };
      fr.readAsDataURL(file);
    });
  }

  // ---------- Главный обработчик ----------
  async function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // чтобы можно было выбрать тот же файл повторно
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProgress("Нужен файл-изображение (PNG, JPG и т.п.)", "error");
      return;
    }

    if (running) return;
    running = true;
    $btn.disabled = true;

    const langs = $lang.value;
    try {
      const dataURL = await fileToDataURL(file);
      const w = await ensureWorker(langs);
      setProgress("Распознавание…", "active");

      const result = await w.recognize(dataURL);
      const text = (result && result.data && result.data.text) ? result.data.text : "";

      if (!text.trim()) {
        setProgress("Текст не найден на изображении", "error");
        return;
      }

      // Подставляем распознанный текст в исходное поле,
      // сохраняя первоначальный пользовательский ввод (добавляем в конец).
      const existing = $srcText.value.trim();
      if (existing) {
        $srcText.value = existing + "\n" + text.trim();
      } else {
        $srcText.value = text.trim();
      }

      // Переводим в режим автоопределения, чтобы распознанный язык детект-нулся сам
      if ($srcLang && $srcLang.value !== "auto") {
        // Если пользователь явно выбрал исходный язык — уважаем это, не меняем.
        // Если был auto — оставляем auto.
      }

      setProgress("Готово, " + text.length + " симв. — перевод обновлён", "done");

      // Триггер input → app.js поймает его через scheduleTranslate → debounce 1с → автоперевод
      $srcText.dispatchEvent(new Event("input", { bubbles: true }));

    } catch (err) {
      console.error("[OCR] error:", err);
      setProgress("Ошибка OCR: " + (err.message || "что-то не так"), "error");
    } finally {
      running = false;
      $btn.disabled = false;
    }
  }

  // ---------- Клик по кнопке → открываем диалог выбора файла ----------
  function onBtnClick() {
    if (running) return;
    $file.click();
  }

  // ---------- Привязка ----------
  $btn.addEventListener("click", onBtnClick);
  $file.addEventListener("change", onFileChosen);

  // Подсказка при первой загрузке страницы — мягко намекаем
  setProgress("Готов к OCR — нажмите 📷 и выберите скриншот", "");
})();
