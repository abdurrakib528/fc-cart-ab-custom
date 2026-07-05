/*!
 * ab-datepicker.js  v2.1.0
 *
 * AbDatepicker + AbTimeslot — zero-dependency date & timeslot picker.
 *
 * Exposes three globals on window:
 *   AbCore       — shared date / timezone / cutoff utilities
 *   AbDatepicker — .init({ daterowId, calendarId, clockId, ... })
 *   AbTimeslot   — .init({ containerId, slots, ... })
 *
 * Drop in a single <script src="ab-datepicker.js"></script> tag — the file is
 * self-contained, has zero external dependencies, and attaches its public
 * API to `window` using UMD-lite style.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ FILE LAYOUT                                                         │
 * │   Section 1 · AbCore ...... constants + date / timezone utilities   │
 * │   Section 2 · AbDatepicker  date row + calendar widget              │
 * │   Section 3 · AbTimeslot .. timeslot grid + rule engine             │
 * └─────────────────────────────────────────────────────────────────────┘
 */
(function (global) {
  "use strict";

  /* ===================================================================
   * SECTION 1 · AbCore
   * -------------------------------------------------------------------
   * Shared utilities used by both widgets. Exposed as `window.AbCore`
   * so consumer code can reuse date key helpers without re-implementing.
   * =================================================================== */

  /* --------------------------- 1.1 Constants -------------------------- */

  var MONTH_NAMES_FULL = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  var DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var DAY_NAMES_LOWER = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  var DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

  /* --------------------- 1.2 Shared timezone state -------------------- */

  var sharedTimezone = DEFAULT_TIMEZONE;

  function getSharedTimezone() {
    return sharedTimezone;
  }

  function setSharedTimezone(timezone) {
    if (timezone) sharedTimezone = timezone;
  }

  /* ------------------------ 1.3 Primitive helpers --------------------- */

  function padTwo(value) {
    return String(value).padStart(2, "0");
  }

  /* --------------- 1.4 Timezone-aware "now" / "today" ---------------- */

  function getDateInTimezone(timezone) {
    var zone = timezone || sharedTimezone;
    return new Date(new Date().toLocaleString("en-US", { timeZone: zone }));
  }

  function getTimeHHMM(timezone) {
    var now = getDateInTimezone(timezone);
    return padTwo(now.getHours()) + ":" + padTwo(now.getMinutes());
  }

  function getTodayKey(timezone) {
    var now = getDateInTimezone(timezone);
    return buildDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /* ----------- 1.5 Date-key helpers (YYYY-MM-DD ↔ DD-MM-YYYY) -------- */

  function buildDateKey(year, monthIndex, day) {
    return year + "-" + padTwo(monthIndex + 1) + "-" + padTwo(day);
  }

  function parseDateKey(key) {
    if (!key) return { y: 0, m: 0, d: 0 };
    var parts = String(key).split("-").map(Number);
    return { y: parts[0], m: parts[1] - 1, d: parts[2] };
  }

  function dateKeyToDisplay(key) {
    if (!key) return null;
    var parts = String(key).split("-");
    return parts[2] + "-" + parts[1] + "-" + parts[0];
  }

  function normalizeDateKey(rawKey) {
    if (!rawKey) return null;
    var value = String(rawKey).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
      var parts = value.split("-");
      return parts[2] + "-" + parts[1] + "-" + parts[0];
    }
    return rawKey;
  }

  function normalizeDateKeyedObject(source) {
    if (!source) return {};
    var normalized = {};

    Object.keys(source).forEach(function (key) {
      normalized[normalizeDateKey(key) || key] = source[key];
    });
    return normalized;
  }

  function addDaysToKey(key, numberOfDays) {
    if (!key) return null;
    var parsed = parseDateKey(key);
    var shifted = new Date(parsed.y, parsed.m, parsed.d + numberOfDays);
    return buildDateKey(
      shifted.getFullYear(),
      shifted.getMonth(),
      shifted.getDate(),
    );
  }

  function getDayOfWeek(key) {
    if (!key) return 0;
    var parsed = parseDateKey(key);
    return new Date(parsed.y, parsed.m, parsed.d).getDay();
  }

  /* --------------------- 1.6 Cutoff (HH:MM) helpers ------------------- */

  function isNowAfterCutoff(cutoff, timezone) {
    return cutoff ? getTimeHHMM(timezone) >= cutoff : false;
  }

  function minutesUntilCutoff(cutoff, timezone) {
    if (!cutoff) return Infinity;
    var cutParts = cutoff.split(":").map(Number);
    var nowParts = getTimeHHMM(timezone).split(":").map(Number);
    return cutParts[0] * 60 + cutParts[1] - (nowParts[0] * 60 + nowParts[1]);
  }

  /* --------------------------- 1.7 Event bus ------------------------- */

  function createEventBus() {
    var listeners = {};

    return {
      on: function (eventName, handler) {
        (listeners[eventName] = listeners[eventName] || []).push(handler);
      },
      off: function (eventName, handler) {
        if (!listeners[eventName]) return;
        if (!handler) {
          delete listeners[eventName];
          return;
        }
        listeners[eventName] = listeners[eventName].filter(function (fn) {
          return fn !== handler;
        });
      },
      emit: function (eventName, payload) {
        (listeners[eventName] || []).forEach(function (handler) {
          try {
            handler(payload);
          } catch (err) {
            console.error("[AbCore bus]", eventName, err);
          }
        });
      },
    };
  }

  /* ---------------------- 1.8 AbCore public surface ------------------ */

  var AbCore = {
    version: "2.1.0",

    // Constants
    MONTH_NAMES: MONTH_NAMES_FULL,
    DAY_ABBR: DAY_NAMES_SHORT,
    DOW_NAMES: DAY_NAMES_LOWER,

    // Shared timezone
    getSharedTimezone: getSharedTimezone,
    setSharedTimezone: setSharedTimezone,

    // Timezone-aware now
    tzNow: getDateInTimezone,
    tzHHMM: getTimeHHMM,
    todayKeyIn: getTodayKey,

    // Date key helpers
    dateKey: buildDateKey,
    parseKey: parseDateKey,
    keyToDisplay: dateKeyToDisplay,
    normalizeKey: normalizeDateKey,
    normalizeDateKeys: normalizeDateKeyedObject,
    addDays: addDaysToKey,
    getDOW: getDayOfWeek,

    // Cutoff helpers
    isAfter: isNowAfterCutoff,
    minsLeft: minutesUntilCutoff,

    // Bus
    createBus: createEventBus,
  };

  global.AbCore = AbCore;

  /* ===================================================================
   * SECTION 2 · AbDatepicker
   * -------------------------------------------------------------------
   * Renders:
   *   • A horizontal 7-day chip strip
   *   • A "See Full Calendar" toggle that expands either inline or as
   *     a popup panel with full month navigation
   *
   * Factory pattern — each call to AbDatepicker.init(opts) returns its
   * own isolated instance with its own DOM, state and public API.
   * =================================================================== */

  function createDatepickerInstance(rawOptions) {
    var options = rawOptions || {};

    /* ------------------------- 2.1 DOM refs ------------------------- */

    var daterowEl = document.getElementById(options.daterowId);
    var calendarEl = document.getElementById(options.calendarId);
    var clockEl = options.clockId
      ? document.getElementById(options.clockId)
      : null;

    /* ------------------ 2.2 Resolve widget settings ----------------- */

    var calendarMode =
      (calendarEl && calendarEl.getAttribute("mode")) ||
      options.mode ||
      "inline";

    var timezone =
      (calendarEl && calendarEl.getAttribute("timezone")) ||
      options.timezone ||
      AbCore.getSharedTimezone();

    var accentColor = options.accent || "#3a8b6b";

    AbCore.setSharedTimezone(timezone);

    /*
     * External trigger button support.
     * -------------------------------------------------------------
     * If `calendarEl` (#my-calendar) is itself a <button>, treat it
     * as the "See Full Calendar" trigger instead of creating a JS
     * button inside the daterow footer. The user can put any text
     * + icons in the button:
     *
     *   <button id="my-calendar" mode="popup" timezone="...">
     *     See full calendar <svg>…</svg>
     *   </button>
     *
     * We snapshot the user's initial HTML as the "default" content;
     * the morph for an out-of-range selected date swaps it for a
     * date label + checkmark and restores the original on the way
     * back. The click handler is wired exactly once.
     */
    var useExternalTrigger = !!(calendarEl && calendarEl.tagName === "BUTTON");
    var defaultTriggerHTML = null;
    var externalTriggerWired = false;
    if (useExternalTrigger) {
      defaultTriggerHTML = calendarEl.innerHTML;
      calendarEl.classList.add("ab-see-full");
      // Reasonable defaults for an unstyled host page
      if (!calendarEl.getAttribute("type"))
        calendarEl.setAttribute("type", "button");
    }

    /* ---------------------- 2.3 Instance state ---------------------- */

    var state = {
      timezone: timezone,
      calendarMode: calendarMode,

      today: null, // { y, m, d }
      todayKey: null, // YYYY-MM-DD

      calendarYear: 0,
      calendarMonth: 0,

      selectedKey: null,
      isCalendarOpen: false,

      blockedDates: options.blockedDates || [], // ['DD-MM-YYYY', ...]
      blockedRanges: options.blockedRanges || [], // [{ start, end }]
      dateCutoffs: options.dateCutoffs || {}, // { 'YYYY-MM-DD': 'HH:MM' }

      /*
       * Cosmetic-only date tags (does NOT block selection — pair with
       * blockedDates if you want a date that is both highlighted and
       * un-clickable). Each entry is one of:
       *   { date:  'YYYY-MM-DD' or 'DD-MM-YYYY', class: 'ab-tag-foo' }
       *   { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', class: 'ab-tag-foo' }
       * The class is appended to BOTH the date-row chip and the
       * matching cell on the full-calendar grid.
       */
      dateClasses: normalizeDateClasses(options.dateClasses),

      cutoffs: {
        prevDay: options.prevDayCutoff || null,
        sameDay: options.sameDayCutoff || null,
        sunday: options.sundayCutoff || null,
        noSunday: !!options.noSunday,
        noSaturday: !!options.noSaturday,
      },

      onChange: options.onChange || null,
      beforeShowDay: options.beforeShowDay || null,
      initialRender: !!options.initialRender,
      slotDependencyEnabled: !!options.slotDependency,

      /*
       * Rule list — same composable pattern as AbTimeslot's rules
       * but scoped to dates (no slot context). Each rule receives:
       *   { date, dateKey, year, month, day, monthName,
       *     dow, dowName, dayofweek, isToday }
       * Return `false` to disable the date. Useful when you want
       * cart-tag / weekday rules even WITHOUT a timeslot widget.
       */
      rules: options.rules || [],

      // Injected by AbTimeslot via linkDatepicker()
      injectedBeforeShowDay: null,

      calendarWrap: null,
      chipEls: [],
      clockIntervalId: null,
    };

    /* ------------------ 2.4 Timezone-bound shortcuts ---------------- */

    function now() {
      return AbCore.tzNow(state.timezone);
    }
    function nowHHMM() {
      return AbCore.tzHHMM(state.timezone);
    }
    function isAfterCutoff(c) {
      return AbCore.isAfter(c, state.timezone);
    }

    function refreshToday() {
      var n = now();
      state.today = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
      state.todayKey = AbCore.dateKey(
        state.today.y,
        state.today.m,
        state.today.d,
      );
    }

    /* ----------------- 2.5 Date-object factory for callback ---------- */

    function buildDateObject(key, disabledOverride) {
      if (disabledOverride === undefined) disabledOverride = null;

      if (!key) {
        return {
          date: null,
          dateKey: null,
          time: nowHHMM(),
          dayofweek: null,
          dayIndex: 0,
          dow: 0,
          dowName: null,
          isToday: false,
          isTomorrow: false,
          isDisabled: true,
          year: 0,
          month: 0,
          day: 0,
          monthName: null,
        };
      }

      var parsed = AbCore.parseKey(key);
      var dayIndex = new Date(parsed.y, parsed.m, parsed.d).getDay();
      var disabled =
        disabledOverride !== null ? disabledOverride : isDateDisabled(key);
      var tmrKey = state.today
        ? AbCore.dateKey(state.today.y, state.today.m, state.today.d + 1)
        : null;

      return {
        // Date in user-facing display format
        date: AbCore.keyToDisplay(key), // 'DD-MM-YYYY'
        dateKey: key, // 'YYYY-MM-DD' (sortable / internal)

        // Calendar parts
        year: parsed.y, // 4-digit year
        month: parsed.m + 1, // 1-12
        day: parsed.d, // 1-31
        monthName: AbCore.MONTH_NAMES[parsed.m], // 'January'..'December'

        // Day of week — both naming styles, identical to AbTimeslot's
        // rule context so a rule can be moved between widgets unchanged.
        dayIndex: dayIndex, // 0=Sun..6=Sat
        dow: dayIndex, // alias of dayIndex
        dayofweek: AbCore.DAY_ABBR[dayIndex], // 'Sun'..'Sat' (3-letter)
        dowName: AbCore.DOW_NAMES[dayIndex], // 'sunday'..'saturday' (lowercase full)

        // Relative-day flags
        isToday: key === state.todayKey,
        isTomorrow: tmrKey ? key === tmrKey : false,

        // Live time in the widget's timezone
        time: nowHHMM(), // 'HH:MM'

        // Disabled flag — useful inside `beforeShowDay` (informational)
        isDisabled: disabled,
      };
    }

    /* -------------------- 2.6 Disable predicates -------------------- */

    function normalizeDateClasses(input) {
      if (!Array.isArray(input)) return [];
      var out = [];
      input.forEach(function (entry) {
        if (!entry || !entry.class) return;
        if (entry.start && entry.end) {
          out.push({
            start: AbCore.normalizeKey(entry.start),
            end: AbCore.normalizeKey(entry.end),
            cls: entry.class,
          });
        } else if (entry.date) {
          out.push({
            key: AbCore.normalizeKey(entry.date),
            cls: entry.class,
          });
        }
      });
      return out;
    }

    function getDateClasses(key) {
      if (!state.dateClasses || !state.dateClasses.length) return "";
      var matches = [];
      var hasRange = false;
      var isRangeStart = false;
      var isRangeEnd = false;
      for (var i = 0; i < state.dateClasses.length; i++) {
        var entry = state.dateClasses[i];
        if (entry.start && entry.end) {
          if (key >= entry.start && key <= entry.end) {
            matches.push(entry.cls);
            hasRange = true;
            if (key === entry.start) isRangeStart = true;
            if (key === entry.end) isRangeEnd = true;
          }
        } else if (entry.key === key) {
          matches.push(entry.cls);
        }
      }
      // Range entries get pill-structure modifier classes so the CSS
      // can paint a continuous bar across adjacent row cells. Boundary
      // = actual range edge OR week edge (Sun=start, Sat=end), so each
      // row's segment of the range rounds off cleanly on its own.
      if (hasRange) {
        matches.push("ab-tag-range");
        var parsed = AbCore.parseKey(key);
        var dow = new Date(parsed.y, parsed.m, parsed.d).getDay();
        if (isRangeStart || dow === 0) matches.push("ab-tag-range-start");
        if (isRangeEnd || dow === 6) matches.push("ab-tag-range-end");
      }
      return matches.join(" ");
    }

    function isPastDate(key) {
      return key < state.todayKey;
    }

    function isExplicitlyBlockedDate(key) {
      var parsed = AbCore.parseKey(key);
      var displayKey =
        padTwo(parsed.d) + "-" + padTwo(parsed.m + 1) + "-" + parsed.y;

      if (state.blockedDates.indexOf(displayKey) !== -1) return true;

      var inRange = state.blockedRanges.some(function (range) {
        return key >= range.start && key <= range.end;
      });
      if (inRange) return true;

      var dow = new Date(parsed.y, parsed.m, parsed.d).getDay();
      if (state.cutoffs.noSunday && dow === 0) return true;
      if (state.cutoffs.noSaturday && dow === 6) return true;

      return false;
    }

    function isCutoffBlocked(key) {
      if (isExplicitlyBlockedDate(key)) return false;

      var hasAnyCutoff =
        state.cutoffs.sameDay ||
        state.cutoffs.prevDay ||
        state.cutoffs.sunday ||
        Object.keys(state.dateCutoffs).length > 0;

      if (!hasAnyCutoff) return false;

      var parsed = AbCore.parseKey(key);
      var dow = new Date(parsed.y, parsed.m, parsed.d).getDay();

      // Same-day cutoff
      if (key === state.todayKey) {
        var sameCutoff =
          state.dateCutoffs[key] ||
          (dow === 0
            ? state.cutoffs.sunday || state.cutoffs.sameDay
            : state.cutoffs.sameDay);
        if (isAfterCutoff(sameCutoff)) return true;
      }

      // Prev-day cutoff (today, for tomorrow's booking)
      var tomorrow = new Date(state.today.y, state.today.m, state.today.d + 1);
      var tomorrowKey = AbCore.dateKey(
        tomorrow.getFullYear(),
        tomorrow.getMonth(),
        tomorrow.getDate(),
      );

      if (key === tomorrowKey) {
        var prevCutoff =
          dow === 0
            ? state.cutoffs.sunday || state.cutoffs.prevDay
            : state.cutoffs.prevDay;
        if (isAfterCutoff(prevCutoff)) return true;
      }

      return false;
    }

    function isDateDisabled(key) {
      if (isPastDate(key)) return true;
      if (isExplicitlyBlockedDate(key)) return true;
      if (isCutoffBlocked(key)) return true;

      if (state.beforeShowDay) {
        try {
          if (state.beforeShowDay(buildDateObject(key, false)) === false)
            return true;
        } catch (err) {
          /* ignore */
        }
      }
      if (state.injectedBeforeShowDay) {
        try {
          if (
            state.injectedBeforeShowDay(buildDateObject(key, false)) === false
          )
            return true;
        } catch (err) {
          /* ignore */
        }
      }

      // User-supplied rules (composable, AbTimeslot-style). Each rule
      // gets a date context — return false from any rule to disable.
      if (state.rules && state.rules.length) {
        var ctx = buildDateObject(key, false);
        for (var i = 0; i < state.rules.length; i++) {
          try {
            if (state.rules[i](ctx) === false) return true;
          } catch (err) {
            console.error("[AbDatepicker] rule error:", err);
          }
        }
      }
      return false;
    }

    function shouldShowCutoffDot(key) {
      if (isDateDisabled(key)) return false;

      var parsed = AbCore.parseKey(key);
      var dow = new Date(parsed.y, parsed.m, parsed.d).getDay();

      return !!(
        state.cutoffs.sameDay ||
        state.cutoffs.prevDay ||
        (dow === 0 && state.cutoffs.sunday) ||
        state.dateCutoffs[key]
      );
    }

    function findNextAvailableDate(maxLookAhead) {
      var lookAhead = maxLookAhead || 365;
      for (var i = 0; i < lookAhead; i++) {
        var candidate = new Date(
          state.today.y,
          state.today.m,
          state.today.d + i,
        );
        var key = AbCore.dateKey(
          candidate.getFullYear(),
          candidate.getMonth(),
          candidate.getDate(),
        );
        if (!isDateDisabled(key)) return key;
      }
      return state.todayKey;
    }

    /* --------------------- 2.7 DOM renderers ------------------------ */

    function renderDateRow() {
      if (!daterowEl) return;

      refreshToday();

      // Use classList.add (not className=) to preserve any host-applied
      // classes on the mount across re-renders.
      daterowEl.innerHTML = "";
      daterowEl.classList.add("ab-dp-root");
      daterowEl.style.setProperty("--ab-accent", accentColor);

      var card = document.createElement("div");
      card.className = "ab-dr-card";
      /*
       * The "See Full Calendar" button has two states (default and
       * selected-out-of-range). When the user supplied their own
       * <button id="my-calendar"> in HTML we use that as the trigger
       * and skip rendering an internal footer button. Otherwise we
       * render the JS-default button inside the footer.
       */
      var internalFooter = useExternalTrigger
        ? ""
        : [
            '<div class="ab-footer">',
            '<button class="ab-see-full" type="button">',
            '<span class="ab-see-full-text">See Full Calendar</span>',
            (window.AB_ICONS && window.AB_ICONS["cal-chevron-down"]) || "",
            "</button>",
            "</div>",
          ].join("");

      card.innerHTML = '<div class="ab-chips"></div>' + internalFooter;

      renderChips(card);
      renderSelectedDateLabel(card);

      // Resolve the actual trigger element (external button OR
      // internal one) and wire the click handler. The external
      // button persists across reloads, so wire it exactly once.
      var toggleBtn = useExternalTrigger
        ? calendarEl
        : card.querySelector(".ab-see-full");
      if (toggleBtn) {
        if (state.isCalendarOpen) toggleBtn.classList.add("ab-open");
        else toggleBtn.classList.remove("ab-open");

        if (useExternalTrigger) {
          if (!externalTriggerWired) {
            calendarEl.addEventListener("click", toggleCalendar);
            externalTriggerWired = true;
          }
        } else {
          toggleBtn.addEventListener("click", toggleCalendar);
        }
      }

      // Tear down any popup that was rendered in a previous reload.
      // For the EXTERNAL-trigger path the wrap lives outside daterowEl
      // (next to the user's trigger button), so the `daterowEl.innerHTML
      // = ''` above doesn't remove it — we have to do that ourselves.
      if (state.calendarWrap && state.calendarWrap.parentNode) {
        state.calendarWrap.parentNode.removeChild(state.calendarWrap);
      }

      state.calendarWrap = renderCalendarPanel(state.calendarMode);
      if (state.isCalendarOpen) state.calendarWrap.classList.add("ab-open");

      if (useExternalTrigger) {
        // Mount the popup right next to the user's trigger button so
        // it always opens 8px below the trigger — no matter where on
        // the page the button has been moved.
        mountPopupNearTrigger();
      } else {
        // Legacy path — popup nests inside the chip-strip card and
        // anchors to its bottom edge via CSS.
        card.appendChild(state.calendarWrap);
      }

      daterowEl.appendChild(card);
      startClock();
    }

    /*
     * External-trigger popup placement.
     * -------------------------------------------------------------
     * Append the calendar wrap as a sibling of the trigger button
     * (inside the button's nearest positioned ancestor) and write
     * its `top` / `left` based on the button's offset. The result:
     * the popup floats exactly 8px under the button regardless of
     * where the button lives — header, footer, sidebar, anywhere.
     *
     * Re-runs on every `openCalendar()` so the popup tracks the
     * button if its position changes (sticky headers, modals, etc).
     */
    function mountPopupNearTrigger() {
      if (!state.calendarWrap || !calendarEl) return;

      // Pick the nearest positioned ancestor — that's the button's
      // own coordinate space. If there isn't one, promote the
      // direct parent so absolute positioning has something to hang
      // off of.
      var host = calendarEl.offsetParent;
      if (!host || host === document.body) {
        host = calendarEl.parentNode || document.body;
        if (host !== document.body) {
          var hostStyle = window.getComputedStyle(host);
          if (hostStyle.position === "static") {
            host.style.position = "relative";
          }
        }
      }

      host.appendChild(state.calendarWrap);
      positionPopupBelowTrigger();
    }

    function positionPopupBelowTrigger() {
      if (!useExternalTrigger || !state.calendarWrap || !calendarEl) return;
      var top = calendarEl.offsetTop + calendarEl.offsetHeight + 15;
      var left = calendarEl.offsetLeft;
      state.calendarWrap.style.top = top + "px";
      state.calendarWrap.style.left = 0;
    }

    /*
     * Morphs the trigger button depending on where the selected
     * date sits:
     *   • In the 7-day chip range → default state
     *       — internal trigger: "See Full Calendar" + chevron
     *       — external trigger: user's original HTML, restored
     *   • OUTSIDE the chip range → date label + checkmark, plus
     *     the `ab-selected-date` class for styling hooks
     */
    function renderSelectedDateLabel(cardRoot) {
      var btn = useExternalTrigger
        ? calendarEl
        : (cardRoot || (daterowEl && daterowEl.querySelector(".ab-dr-card"))) &&
          (cardRoot || daterowEl.querySelector(".ab-dr-card")).querySelector(
            ".ab-see-full",
          );
      if (!btn) return;

      var isOutOfRange =
        state.selectedKey &&
        !state.chipEls.some(function (chip) {
          return chip.dataset.key === state.selectedKey;
        });

      if (!isOutOfRange) {
        // Default state ─ restore user's HTML (external) or rebuild
        // the JS default (internal).
        btn.classList.remove("ab-selected-date");
        if (useExternalTrigger) {
          btn.innerHTML = defaultTriggerHTML;
        } else {
          var textEl = btn.querySelector(".ab-see-full-text");
          var iconEl = btn.querySelector(".ab-see-full-icon");
          if (textEl) textEl.textContent = "See Full Calendar";
          if (iconEl) {
            iconEl.setAttribute("viewBox", "0 0 12 12");
            iconEl.innerHTML =
              '<path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.6" ' +
              'stroke-linecap="round" stroke-linejoin="round"/>';
          }
        }
        return;
      }

      // Out-of-range state ─ show the friendly date + checkmark.
      var parsed = AbCore.parseKey(state.selectedKey);
      var dow = new Date(parsed.y, parsed.m, parsed.d).getDay();
      var friendly =
        AbCore.DAY_ABBR[dow] +
        ", " +
        parsed.d +
        " " +
        AbCore.MONTH_NAMES[parsed.m] +
        " " +
        parsed.y;

      btn.classList.add("ab-selected-date");
      btn.innerHTML =
        '<span class="ab-see-full-text">' +
        friendly +
        "</span>" +
        ((window.AB_ICONS && window.AB_ICONS["cal-check"]) || "");
    }

    function renderChips(cardRoot) {
      state.chipEls = [];

      var chipsWrap = cardRoot.querySelector(".ab-chips");
      var currentNow = now();
      var fragment = document.createDocumentFragment();

      for (var i = 0; i < 7; i++) {
        var cellDate = new Date(
          currentNow.getFullYear(),
          currentNow.getMonth(),
          currentNow.getDate() + i,
        );
        var key = AbCore.dateKey(
          cellDate.getFullYear(),
          cellDate.getMonth(),
          cellDate.getDate(),
        );
        var isToday = key === state.todayKey;
        var disabled = isDateDisabled(key);
        var hasDot = !disabled && shouldShowCutoffDot(key);

        var chip = document.createElement("div");
        chip.dataset.key = key;
        chip.innerHTML = [
          '<span class="ab-dow">',
          isToday ? "Today" : AbCore.DAY_ABBR[cellDate.getDay()],
          "</span>",
          '<span class="ab-dom">',
          cellDate.getDate(),
          "</span>",
          hasDot ? '<span class="ab-chip-dot"></span>' : "",
        ].join("");
        applyChipClasses(chip, key, isToday, disabled);
        state.chipEls.push(chip);

        if (!disabled) {
          (function (capturedKey, capturedDate) {
            chip.addEventListener("click", function () {
              selectDateFromChip(capturedKey, capturedDate);
            });
          })(key, cellDate);
        }

        fragment.appendChild(chip);
      }

      chipsWrap.appendChild(fragment);
    }

    function applyChipClasses(chipEl, key, isToday, disabled) {
      var selected = key === state.selectedKey;
      var tagCls = !disabled ? getDateClasses(key) : "";

      chipEl.className = [
        "ab-chip",
        disabled && isToday ? "ab-dis ab-today-dis" : "",
        disabled && !isToday ? "ab-dis" : "",
        !disabled && isToday ? "ab-today" : "",
        !disabled && selected ? "ab-sel" : "",
        tagCls,
      ]
        .filter(Boolean)
        .join(" ");
    }

    function refreshChips() {
      refreshToday();
      state.chipEls.forEach(function (chip) {
        var key = chip.dataset.key;
        applyChipClasses(
          chip,
          key,
          key === state.todayKey,
          isDateDisabled(key),
        );
      });
    }

    function selectDateFromChip(key, cellDate) {
      state.selectedKey = key;
      state.calendarYear = cellDate.getFullYear();
      state.calendarMonth = cellDate.getMonth();

      if (state.calendarWrap) {
        renderCalendarGrid(state.calendarWrap);
        syncPrevButton(state.calendarWrap);
      }

      closeCalendar();
      refreshChips();
      if (state.calendarWrap) syncSelectionBar(state.calendarWrap);
      renderSelectedDateLabel();

      fireChange(key);
    }

    /* --------------------- 2.8 Calendar panel ----------------------- */

    function renderCalendarPanel(mode) {
      var isPopup = mode === "popup";
      var wrap = document.createElement("div");

      wrap.className = isPopup ? "ab-popup-wrap" : "ab-inline-wrap";
      wrap.dataset.calPanel = "1";

      var innerMarkup = [
        '<div class="ab-cal-panel">',
        '<div class="ab-cal-nav">',
        '<button class="ab-nav-btn ab-prev" aria-label="Previous month">',
        (window.AB_ICONS && window.AB_ICONS["cal-prev"]) || "",
        "</button>",
        '<span class="ab-month-label"></span>',
        '<button class="ab-nav-btn ab-next" aria-label="Next month">',
        (window.AB_ICONS && window.AB_ICONS["cal-next"]) || "",
        "</button>",
        "</div>",
        '<div class="ab-cal-grid"></div>',
        "</div>",
        '<div class="ab-sel-bar">',
        '<span class="ab-sb-l">Selected</span>',
        '<span class="ab-sb-v">—</span>',
        "</div>",
      ].join("");

      wrap.innerHTML = isPopup
        ? innerMarkup
        : '<div class="ab-inline-inner"><div class="ab-hr"></div>' +
          innerMarkup +
          "</div>";

      wrap.querySelector(".ab-prev").addEventListener("click", function () {
        if (isAtMinimumMonth()) return;
        state.calendarMonth--;
        if (state.calendarMonth < 0) {
          state.calendarMonth = 11;
          state.calendarYear--;
        }
        renderCalendarGrid(wrap);
        syncPrevButton(wrap);
      });

      wrap.querySelector(".ab-next").addEventListener("click", function () {
        state.calendarMonth++;
        if (state.calendarMonth > 11) {
          state.calendarMonth = 0;
          state.calendarYear++;
        }
        renderCalendarGrid(wrap);
        syncPrevButton(wrap);
      });

      renderCalendarGrid(wrap);
      syncPrevButton(wrap);
      return wrap;
    }

    function isAtMinimumMonth() {
      return (
        state.calendarYear < state.today.y ||
        (state.calendarYear === state.today.y &&
          state.calendarMonth <= state.today.m)
      );
    }

    function syncPrevButton(wrap) {
      var btn = wrap.querySelector(".ab-prev");
      if (!btn) return;

      var atMin = isAtMinimumMonth();
      btn.disabled = atMin;
      btn.style.opacity = atMin ? "0.3" : "";
      btn.style.cursor = atMin ? "not-allowed" : "";
      btn.style.pointerEvents = atMin ? "none" : "";
    }

    function renderCalendarGrid(wrap) {
      var year = state.calendarYear;
      var month = state.calendarMonth;

      var label = wrap.querySelector(".ab-month-label");
      if (label) label.textContent = AbCore.MONTH_NAMES[month] + " " + year;

      var grid = wrap.querySelector(".ab-cal-grid");
      if (!grid) return;

      grid.innerHTML = "";
      var fragment = document.createDocumentFragment();

      AbCore.DAY_ABBR.forEach(function (abbr) {
        var header = document.createElement("div");
        header.className = "ab-g-dow";
        header.textContent = abbr;
        fragment.appendChild(header);
      });

      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      // Leading empty cells
      for (var i = 0; i < firstDay; i++) {
        var empty = document.createElement("div");
        empty.className = "ab-cell ab-cell-empty";
        fragment.appendChild(empty);
      }

      // Real day cells
      for (var day = 1; day <= daysInMonth; day++) {
        var key = AbCore.dateKey(year, month, day);
        var past = isPastDate(key);
        var disabled = !past && isDateDisabled(key);
        var hasDot = !past && !disabled && shouldShowCutoffDot(key);

        var cell = document.createElement("div");
        cell.dataset.key = key;
        cell.innerHTML =
          '<span class="ab-cn">' +
          day +
          "</span>" +
          (hasDot ? '<span class="ab-cell-dot"></span>' : "");

        applyCellClasses(cell, key, past, disabled);

        if (!past && !disabled) {
          (function (capturedKey) {
            cell.addEventListener("click", function () {
              handleCellClick(capturedKey, wrap);
            });
          })(key);
        }

        fragment.appendChild(cell);
      }

      // Trailing empty cells
      var totalCells = firstDay + daysInMonth;
      var trailing = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
      for (var j = 0; j < trailing; j++) {
        var emptyTail = document.createElement("div");
        emptyTail.className = "ab-cell ab-cell-empty";
        fragment.appendChild(emptyTail);
      }

      grid.appendChild(fragment);
      syncSelectionBar(wrap);
      syncPrevButton(wrap);
    }

    function patchCalendarGrid(wrap) {
      if (!wrap) return;
      refreshToday();

      wrap
        .querySelectorAll(".ab-cell:not(.ab-cell-empty)")
        .forEach(function (cell) {
          var key = cell.dataset.key;
          var past = isPastDate(key);
          applyCellClasses(cell, key, past, !past && isDateDisabled(key));
        });

      syncSelectionBar(wrap);
    }

    function applyCellClasses(cellEl, key, past, disabled) {
      var selected = key === state.selectedKey;
      var isToday = key === state.todayKey;
      var tagCls = !past && !disabled ? getDateClasses(key) : "";

      cellEl.className = [
        "ab-cell",
        past ? "ab-cc-past" : "",
        !past && disabled && isToday ? "ab-cc-dis ab-cc-today-dis" : "",
        !past && disabled && !isToday ? "ab-cc-dis" : "",
        !past && !disabled && selected ? "ab-cc-sel" : "",
        !past && !disabled && isToday && !selected ? "ab-cc-today" : "",
        tagCls,
      ]
        .filter(Boolean)
        .join(" ");
    }

    function handleCellClick(key, wrap) {
      state.selectedKey = key;
      var parsed = AbCore.parseKey(key);
      state.calendarYear = parsed.y;
      state.calendarMonth = parsed.m;

      renderCalendarGrid(wrap);
      syncPrevButton(wrap);
      refreshChips();
      closeCalendar();
      renderSelectedDateLabel();

      fireChange(key);
    }

    function syncSelectionBar(wrap) {
      if (!wrap) return;
      var bar = wrap.querySelector(".ab-sel-bar");
      var value = wrap.querySelector(".ab-sb-v");
      if (!bar || !value) return;

      if (state.selectedKey) {
        bar.classList.add("ab-on");
        value.textContent = AbCore.keyToDisplay(state.selectedKey);
      } else {
        bar.classList.remove("ab-on");
      }
    }

    /* ------------------ 2.9 Calendar open / close ------------------- */

    function toggleCalendar() {
      if (state.isCalendarOpen) closeCalendar();
      else openCalendar();
    }

    // Returns the active trigger button — the user's <button id="my-calendar">
    // when present, otherwise the JS-rendered footer button.
    function getTriggerBtn() {
      if (useExternalTrigger) return calendarEl;
      return daterowEl && daterowEl.querySelector(".ab-see-full");
    }

    function openCalendar() {
      state.isCalendarOpen = true;
      if (!state.calendarWrap) return;

      // Re-pin the popup under the trigger before showing it — the
      // button may have moved since last open (responsive layout
      // change, sticky header collapsing, etc).
      if (useExternalTrigger) positionPopupBelowTrigger();

      state.calendarWrap.classList.add("ab-open");
      var btn = getTriggerBtn();
      if (btn) btn.classList.add("ab-open");

      patchCalendarGrid(state.calendarWrap);
      syncPrevButton(state.calendarWrap);

      if (state.calendarMode === "popup") {
        setTimeout(function () {
          document.addEventListener("click", handleOutsideClick);
        }, 0);
      }
    }

    function closeCalendar() {
      if (!state.isCalendarOpen) return;
      state.isCalendarOpen = false;

      if (state.calendarWrap) state.calendarWrap.classList.remove("ab-open");
      var btn = getTriggerBtn();
      if (btn) btn.classList.remove("ab-open");

      document.removeEventListener("click", handleOutsideClick);
    }

    function handleOutsideClick(event) {
      // Stay open when the click lands inside any of:
      //   • the trigger button (which would otherwise re-open us)
      //   • the popup itself (because external-trigger popups now
      //     live OUTSIDE the daterow card)
      //   • the daterow card (legacy internal-trigger layout)
      var trigger = useExternalTrigger ? calendarEl : null;
      var card = daterowEl && daterowEl.querySelector(".ab-dr-card");
      var popup = state.calendarWrap;

      if (trigger && trigger.contains(event.target)) return;
      if (popup && popup.contains(event.target)) return;
      if (card && card.contains(event.target)) return;

      closeCalendar();
    }

    /* ------------------------- 2.10 Clock --------------------------- */

    function startClock() {
      function tick() {
        var timeText = now().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        if (clockEl) clockEl.textContent = timeText;
      }

      tick();
      clearInterval(state.clockIntervalId);
      clearTimeout(state.clockTimeoutId);

      // Align to the next system-clock minute boundary so the
      // displayed minute flips at the same instant as the OS clock.
      var msUntilNextMinute = 60000 - (Date.now() % 60000);
      state.clockTimeoutId = setTimeout(function () {
        tick();
        state.clockIntervalId = setInterval(tick, 60000);
      }, msUntilNextMinute);
    }

    /* ------------------- 2.11 onChange dispatcher ------------------- */

    function fireChange(key) {
      if (!state.onChange) return;
      state.onChange(
        Object.assign({ type: "single" }, buildDateObject(key, false)),
      );
    }

    /* ----------------------- 2.12 Reload ---------------------------- */

    /*
     * Reload the date row + calendar with the current rule set and
     * realign the selection to the EARLIEST non-disabled date. The
     * selected chip therefore tracks rule changes in BOTH directions:
     *
     *   • a previously-valid date becomes disabled
     *       → selection auto-advances forward to the next valid date
     *   • previously-disabled dates become valid again (e.g. a cart
     *     constraint is lifted)
     *       → selection rewinds back to the new earliest date
     *
     * Realignment respects every active disable source — blockedDates,
     * blockedRanges, no-Saturday/Sunday, dateCutoffs, beforeShowDay,
     * AND the predicate injected by AbTimeslot via linkDatepicker
     * (which mirrors timeslot rules into the picker). When the
     * selection actually moves, `onChange` fires once so dependent
     * widgets (typically the timeslot card) sync to the new date.
     */
    function reload() {
      refreshToday();
      state.calendarYear = state.today.y;
      state.calendarMonth = state.today.m;

      var prevSelection = state.selectedKey;
      state.selectedKey = findNextAvailableDate();

      if (state.selectedKey) {
        var p = AbCore.parseKey(state.selectedKey);
        state.calendarYear = p.y;
        state.calendarMonth = p.m;
      }

      renderDateRow();

      if (
        state.selectedKey &&
        state.selectedKey !== prevSelection &&
        state.onChange
      ) {
        fireChange(state.selectedKey);
      }
    }

    /* -------------------- 2.13 Bootstrap --------------------------- */

    refreshToday();

    state.selectedKey = isDateDisabled(state.todayKey)
      ? findNextAvailableDate()
      : state.todayKey;

    if (state.selectedKey) {
      var parsedSel = AbCore.parseKey(state.selectedKey);
      state.calendarYear = parsedSel.y;
      state.calendarMonth = parsedSel.m;
    } else {
      state.calendarYear = state.today.y;
      state.calendarMonth = state.today.m;
    }

    /*
     * Render the widget immediately. The skeleton overlay (owned by
     * the host page — see ab-cart-section.css/js) sits on top of the
     * real content and the host flips `.ab-ready` on its own timer.
     */
    renderDateRow();
    if (state.initialRender && state.selectedKey && state.onChange) {
      requestAnimationFrame(function () {
        fireChange(state.selectedKey);
      });
    }

    /* -------------------- 2.14 Public API -------------------------- */

    return {
      getSelected: function () {
        return AbCore.keyToDisplay(state.selectedKey);
      },
      setCalMode: function (mode) {
        state.calendarMode = mode;
        closeCalendar();
        reload();
      },
      open: function () {
        openCalendar();
      },
      close: function () {
        closeCalendar();
      },

      addBlockedDate: function (displayKey) {
        state.blockedDates.push(displayKey);
        reload();
      },
      clearBlockedDates: function () {
        state.blockedDates = [];
        reload();
      },

      // Cosmetic date tags — replace the whole list, append one,
      // or clear them all. Each entry uses the same shape as the
      // `dateClasses` init option (single date OR { start, end }
      // range, paired with a CSS class name).
      setDateClasses: function (arr) {
        state.dateClasses = normalizeDateClasses(arr);
        reload();
      },
      addDateClass: function (entry) {
        var normalized = normalizeDateClasses([entry]);
        if (normalized.length) state.dateClasses.push(normalized[0]);
        reload();
      },
      clearDateClasses: function () {
        state.dateClasses = [];
        reload();
      },

      // Composable date-level rules. Use these when you want
      // tag/weekday/cart logic in the picker WITHOUT having to mount
      // an AbTimeslot widget. Both setRules() and addRule() trigger
      // a reload(), so the chip strip + calendar grid + selection
      // realign automatically.
      setRules: function (arr) {
        state.rules = arr || [];
        reload();
      },
      addRule: function (fn) {
        state.rules.push(fn);
        reload();
      },

      reload: reload,

      // Private surface — used by AbTimeslot.linkDatepicker / demos
      _injectBeforeShowDay: function (predicate) {
        state.injectedBeforeShowDay = predicate;
        reload();
      },
      get _slotDependency() {
        return state.slotDependencyEnabled;
      },
      _selectDate: function (key) {
        if (!key || state.selectedKey === key) return;
        state.selectedKey = key;

        var parsed = AbCore.parseKey(key);
        state.calendarYear = parsed.y;
        state.calendarMonth = parsed.m;

        renderDateRow();
        fireChange(key);
      },
    };
  }

  global.AbDatepicker = {
    init: createDatepickerInstance,
    version: "2.1.0",
  };

  /* ===================================================================
   * SECTION 3 · AbTimeslot
   * -------------------------------------------------------------------
   * Renders a grid of timeslot chips for the currently selected date.
   *
   * Resolution precedence for each slot (highest wins):
   *   1. Custom rule functions  (opts.rules)
   *   2. Per-date override      (opts.blockSlotsByDate[dateKey][slotId])
   *   3. Per-weekday rule       (opts.weekdayRules[dowName][slotId])
   *   4. Slot definition        (opts.slots[i])
   *   5. Global block list      (opts.blockSlots)
   *   6. Prev-day / same-day cutoffs
   * =================================================================== */

  function createTimeslotInstance(rawOptions) {
    var options = rawOptions || {};

    /* ------------------- 3.1 DOM + section ------------------------- */

    var containerEl = document.getElementById(options.containerId);
    if (!containerEl) {
      console.error("[AbTimeslot] containerId not found:", options.containerId);
      return null;
    }

    /* --------------------- 3.2 Instance state ---------------------- */
    /*
     * Timezone resolution order (first non-empty wins):
     *   1. `timezone` HTML attribute on the container element
     *   2. `opts.timezone`
     *   3. AbCore shared timezone (set by AbDatepicker if mounted earlier)
     */

    var state = {
      timezone:
        (containerEl && containerEl.getAttribute("timezone")) ||
        options.timezone ||
        AbCore.getSharedTimezone(),
      noSlotsText:
        options.noSlotsText || "No delivery slots available for this date.",

      slots: options.slots || [],
      blockSlots: options.blockSlots || [],
      blockSlotsByDate: AbCore.normalizeDateKeys(options.blockSlotsByDate),
      weekdayRules: options.weekdayRules || {},
      rules: options.rules || [],

      onChange: options.onChange || null,

      currentDateKey: null,
      selectedSlotId: null,

      // Used by linkDatepicker
      onRenderHook: null,
      isAdvancing: false,
      refreshIntervalId: null,

      // Track the dynamic count class (`ab-ts-grid-N`) so we can
      // remove the previous one on the next render — required because
      // we use classList.add (instead of className=) to preserve any
      // host-applied classes on the mount.
      _lastCountClass: null,
    };

    /* --------------- 3.3 Timezone-bound shortcuts ----------------- */

    function nowHHMM() {
      return AbCore.tzHHMM(state.timezone);
    }
    function todayKey() {
      return AbCore.todayKeyIn(state.timezone);
    }
    function isAfterCutoff(c) {
      return AbCore.isAfter(c, state.timezone);
    }

    /* ------------- 3.4 Override + weekday rule resolvers ---------- */

   function applyOverride(cfg, override) {
      if (override === false || override === null) return "hidden";
      if (override === "force") return "available";
      if (override === "open") {
        cfg.prevdayCutoff = null;
        return null;
      }
      // "unavailable" — show the slot but render it greyed-out and
      // un-clickable. Must be matched BEFORE the generic-string
      // branch below, which otherwise treats it as an HH:MM cutoff.
      if (override === "unavailable") return "unavailable";
      if (typeof override === "string") {
        cfg.samedayCutoff = override;
        cfg.prevdayCutoff = null;
        return null;
      }
      if (typeof override === "object" && override) {
        var hasSame = "samedayCutoff" in override;
        var hasPrev = "prevdayCutoff" in override;

        if ("hidden" in override) cfg.hidden = override.hidden;
        if ("unavailable" in override) cfg.unavailable = override.unavailable;

        // Mutual exclusion: setting one auto-nulls the other unless both
        // are explicitly provided. Keeps slot config consistent.
        if (hasSame && hasPrev) {
          cfg.samedayCutoff = override.samedayCutoff;
          cfg.prevdayCutoff = override.prevdayCutoff;
        } else if (hasSame) {
          cfg.samedayCutoff = override.samedayCutoff;
          cfg.prevdayCutoff = null;
        } else if (hasPrev) {
          cfg.prevdayCutoff = override.prevdayCutoff;
          cfg.samedayCutoff = null;
        }

        if (cfg.hidden) return "hidden";
        if (cfg.unavailable) return "unavailable";
      }
      return null;
    }

    function resolveWeekdayOverride(dow, dowName, slotId) {
      var entry =
        state.weekdayRules[dowName] ||
        state.weekdayRules[
          dowName.charAt(0).toUpperCase() + dowName.slice(1)
        ] ||
        state.weekdayRules[dow];

      if (!entry) return undefined;
      if (Array.isArray(entry)) {
        return entry.indexOf(slotId) !== -1 ? false : undefined;
      }
      return slotId in entry ? entry[slotId] : undefined;
    }

    /* ------------------- 3.5 Slot status resolver ----------------- */

    function computeSlotStatus(slot, dateKey) {
      if (!dateKey) return "hidden";

      var today = todayKey();
      var isTodayDate = dateKey === today;
      var isTmrDate = dateKey === AbCore.addDays(today, 1);
      var dow = AbCore.getDOW(dateKey);
      var dowName = AbCore.DOW_NAMES[dow];
      var nowTime = nowHHMM();

      // Mutable per-evaluation config — may be mutated by rules.
      // Slots should specify EITHER samedayCutoff OR prevdayCutoff,
      // never both. Whichever is omitted implicitly defaults to null.
      var cfg = {
        hidden: false,
        unavailable: false,
        samedayCutoff: slot.samedayCutoff || null,
        prevdayCutoff: slot.prevdayCutoff || null,
        _forceOpen: false,
      };

      // Step 1 — slot open?
      if (!slot.open) return "hidden";

      // Step 2 — global block list
      if (state.blockSlots.indexOf(slot.id) !== -1) return "hidden";

      // Step 3 — per-date override (wins over weekday)
      var dateOverride = (state.blockSlotsByDate[dateKey] || {})[slot.id];
      if (dateOverride !== undefined) {
        var dateResult = applyOverride(cfg, dateOverride);
        if (dateResult !== null) return dateResult;
      } else {
        // Step 4 — per-weekday rule
        var wdOverride = resolveWeekdayOverride(dow, dowName, slot.id);
        if (wdOverride !== undefined) {
          var wdResult = applyOverride(cfg, wdOverride);
          if (wdResult !== null) return wdResult;
        }
      }

      // Step 5 — custom rule functions
      var ruleContext = {
        slot: slot,
        date: AbCore.keyToDisplay(dateKey),
        dateKey: dateKey,
        dow: dow,
        dowName: dowName,
        isToday: isTodayDate,
        isTomorrow: isTmrDate,
        now: nowTime,
        cfg: cfg,
      };
      for (var i = 0; i < state.rules.length; i++) {
        try {
          var ruleReturn = state.rules[i](ruleContext);
          if (ruleReturn === false) return "hidden";
          if (cfg.hidden) return "hidden";
          if (cfg._forceOpen) return "available";
          if (cfg.unavailable) return "unavailable";
        } catch (err) {
          console.error("[AbTimeslot] rule error:", err);
        }
      }

      // Step 6 — prev-day cutoff enforcement
      if (cfg.prevdayCutoff) {
        var deadline = AbCore.addDays(dateKey, -1);
        if (today >= dateKey) return "unavailable";
        if (today === deadline && isAfterCutoff(cfg.prevdayCutoff))
          return "unavailable";
      }

      // Step 7 — same-day cutoff enforcement
      if (cfg.samedayCutoff && isTodayDate) {
        if (isAfterCutoff(cfg.samedayCutoff)) return "unavailable";
      }

      return "available";
    }

    function dateHasAvailableSlots(dateKey) {
      return state.slots.some(function (slot) {
        return computeSlotStatus(slot, dateKey) === "available";
      });
    }

    /*
     * Scans forward from today up to `maxScan` days and returns the
     * first date that has any available slot. Used to pin the
     * "Closes Soon" badge to the earliest bookable date only.
     */
    function findFirstAvailableDateKey(maxScan) {
      var limit = maxScan || 60;
      var start = todayKey();
      for (var i = 0; i < limit; i++) {
        var candidate = AbCore.addDays(start, i);
        if (dateHasAvailableSlots(candidate)) return candidate;
      }
      return null;
    }

    /* ----------------- 3.6 Auto-refresh timer --------------------- */

    function startRefreshTimer() {
      stopRefreshTimer();
      if (!state.currentDateKey || state.slots.length === 0) return;

      var today = todayKey();
      var tomorrow = AbCore.addDays(today, 1);
      if (state.currentDateKey !== today && state.currentDateKey !== tomorrow)
        return;

      state.refreshIntervalId = setInterval(function () {
        render();
      }, 30000);
    }

    function stopRefreshTimer() {
      if (state.refreshIntervalId) {
        clearInterval(state.refreshIntervalId);
        state.refreshIntervalId = null;
      }
    }

    /* ---------------------- 3.7 Render ---------------------------- */

    /*
     * `render` paints the timeslot grid synchronously. The skeleton
     * overlay (owned by the host page — see ab-cart-section.css/js)
     * sits on top of the real content, so painting immediately gives
     * the wrapper its real height while the shimmer is still up.
     */
    function render() {
      // Use classList.add (not className=) to preserve any host-applied
      // classes on the mount across re-renders.
      containerEl.innerHTML = "";
      if (state._lastCountClass) {
        containerEl.classList.remove(state._lastCountClass);
      }
      containerEl.classList.remove("ab-ts-empty");
      containerEl.classList.add("ab-ts-grid");

      if (!state.currentDateKey) return;

      // Precompute statuses
      var computed = state.slots.map(function (slot) {
        return {
          slot: slot,
          status: computeSlotStatus(slot, state.currentDateKey),
        };
      });

      var visibleEntries = computed.filter(function (entry) {
        return entry.status !== "hidden";
      });
      state._lastCountClass = "ab-ts-grid-" + visibleEntries.length;
      containerEl.classList.add(state._lastCountClass);

      /*
       * "Closes Soon" badge — pinned to the FIRST AVAILABLE slot of
       * the EARLIEST available date (scanning forward from today).
       * If the user navigates the picker to a later date, no badge
       * is shown on that date — the urgency signal belongs to the
       * nearest bookable option only.
       */
      var firstAvailDateKey = findFirstAvailableDateKey();
      var badgedSlotId = null;
      if (firstAvailDateKey && state.currentDateKey === firstAvailDateKey) {
        var firstAvailEntry = computed.find(function (entry) {
          return entry.status === "available";
        });
        if (firstAvailEntry) badgedSlotId = firstAvailEntry.slot.id;
      }

      var fragment = document.createDocumentFragment();
      var clickableCount = 0;
      var firstSlot = null;
      var firstChip = null;

      computed.forEach(function (entry) {
        var slot = entry.slot;
        var status = entry.status;
        if (status === "hidden") return;

        var showBadge = status === "available" && slot.id === badgedSlotId;

        var chip = document.createElement("div");
        chip.className = "ab-ts-chip";
        chip.dataset.slotId = slot.id;
        chip.dataset.status = status;
        chip.innerHTML = [
          showBadge ? '<span class="ab-ts-badge">Closes Soon</span>' : "",
          '<span class="ab-ts-label">',
          slot.label,
          "</span>",
          status === "unavailable"
            ? '<span class="ab-ts-unavail">Cut-off passed</span>'
            : '<span class="ab-ts-time">' + slot.timeRange + "</span>",
        ].join("");

        if (status === "unavailable") chip.classList.add("ab-ts-dis");

        if (slot.id === state.selectedSlotId && status !== "unavailable") {
          chip.classList.add("ab-ts-sel");
        }

        if (status !== "unavailable") {
          clickableCount++;
          if (!firstSlot) {
            firstSlot = slot;
            firstChip = chip;
          }

          (function (capturedSlot, capturedStatus, capturedChip) {
            capturedChip.addEventListener("click", function () {
              state.selectedSlotId = capturedSlot.id;
              containerEl.querySelectorAll(".ab-ts-chip").forEach(function (c) {
                c.classList.remove("ab-ts-sel");
              });
              capturedChip.classList.add("ab-ts-sel");

              if (state.onChange) {
                state.onChange({
                  dateKey: state.currentDateKey,
                  slot: capturedSlot,
                  status: capturedStatus,
                });
              }
            });
          })(slot, status, chip);
        }

        fragment.appendChild(chip);
      });

      // Empty state
      if (clickableCount === 0) {
        containerEl.classList.add("ab-ts-empty");
        var msg = document.createElement("div");
        msg.className = "ab-ts-no-slots";
        msg.textContent = state.noSlotsText;
        containerEl.appendChild(msg);
        state.selectedSlotId = null;
      } else {
        containerEl.classList.remove("ab-ts-empty");
        containerEl.appendChild(fragment);

        // Auto-select first clickable chip
        if (!state.selectedSlotId && firstSlot && firstChip) {
          state.selectedSlotId = firstSlot.id;
          firstChip.classList.add("ab-ts-sel");

          if (state.onChange) {
            var payload = {
              slot: firstSlot,
              status: firstChip.dataset.status,
              key: state.currentDateKey,
            };
            setTimeout(function () {
              state.onChange({
                dateKey: payload.key,
                slot: payload.slot,
                status: payload.status,
              });
            }, 0);
          }
        }
      }

      startRefreshTimer();
      // Call the onRenderHook synchronously so a failed render (no
      // slots for the current date) immediately auto-advances to the
      // next valid date in the SAME tick — no flicker of "no chip
      // selected / no slots available" between frames. Re-entrancy
      // is still prevented by the hook's own `isAdvancing` guard.
      if (state.onRenderHook) state.onRenderHook(clickableCount > 0);
    }

    /* ---------------------- 3.8 Public API ------------------------ */

    return {
      setDate: function (rawDateKey) {
        var key = AbCore.normalizeKey(rawDateKey);
        if (!key) return;
        state.currentDateKey = key;
        state.selectedSlotId = null;
        render();
      },

      getSelected: function () {
        if (!state.selectedSlotId || !state.currentDateKey) return null;
        var slot = state.slots.find(function (s) {
          return s.id === state.selectedSlotId;
        });
        return slot ? { dateKey: state.currentDateKey, slot: slot } : null;
      },

      clearSelection: function () {
        state.selectedSlotId = null;
        containerEl.querySelectorAll(".ab-ts-chip").forEach(function (chip) {
          chip.classList.remove("ab-ts-sel");
        });
      },

      refresh: function () {
        render();
      },

      hasAvailableSlots: function (rawDateKey) {
        return dateHasAvailableSlots(AbCore.normalizeKey(rawDateKey));
      },

      // Slot definitions
      setSlots: function (slots) {
        state.slots = slots || [];
        state.selectedSlotId = null;
        render();
      },
      patchSlot: function (slotId, patch) {
        var slot = state.slots.find(function (s) {
          return s.id === slotId;
        });
        if (slot) Object.assign(slot, patch);
        render();
      },

      // Global block list
      setBlockSlots: function (ids) {
        state.blockSlots = ids || [];
        render();
      },
      addBlockSlots: function () {
        [].slice
          .call(arguments)
          .flat()
          .forEach(function (id) {
            if (state.blockSlots.indexOf(id) === -1) state.blockSlots.push(id);
          });
        render();
      },
      removeBlockSlots: function () {
        [].slice
          .call(arguments)
          .flat()
          .forEach(function (id) {
            state.blockSlots = state.blockSlots.filter(function (x) {
              return x !== id;
            });
          });
        render();
      },

      // Per-date overrides
      setBlockSlotsByDate: function (obj) {
        state.blockSlotsByDate = AbCore.normalizeDateKeys(obj);
        render();
      },
      addBlockSlotsByDate: function (obj) {
        var normalized = AbCore.normalizeDateKeys(obj);
        Object.keys(normalized).forEach(function (dateKey) {
          if (!state.blockSlotsByDate[dateKey]) {
            state.blockSlotsByDate[dateKey] = normalized[dateKey];
          } else {
            Object.assign(state.blockSlotsByDate[dateKey], normalized[dateKey]);
          }
        });
        render();
      },

      // Per-weekday rules
      setWeekdayRules: function (obj) {
        state.weekdayRules = obj || {};
        render();
      },
      addWeekdayRules: function (obj) {
        Object.keys(obj || {}).forEach(function (dow) {
          state.weekdayRules[dow] = Object.assign(
            state.weekdayRules[dow] || {},
            obj[dow],
          );
        });
        render();
      },

      // Custom rule fns
      setRules: function (arr) {
        state.rules = arr || [];
        render();
      },
      addRule: function (fn) {
        state.rules.push(fn);
        render();
      },

      /*
       * Link to AbDatepicker.
       *
       * 1. Seeds the timeslot with the picker's current date
       *    (idempotent — skipped if a date is already set).
       * 2. If `slotDependency` is enabled (either via this call or via
       *    the picker's own option), dates with zero available slots
       *    become disabled in the picker, and the picker auto-advances
       *    to the next valid date within `lookAheadDays`.
       *
       * @param picker                       AbDatepicker instance
       * @param [linkOptions.slotDependency] override the picker's flag
       * @param [linkOptions.lookAheadDays=60] max days to scan forward
       */
      linkDatepicker: function (picker, linkOptions) {
        linkOptions = linkOptions || {};

        // Step 1 — seed the timeslot with the picker's current date
        if (
          !state.currentDateKey &&
          picker &&
          typeof picker.getSelected === "function"
        ) {
          var initialKey = AbCore.normalizeKey(picker.getSelected());
          if (initialKey) {
            state.currentDateKey = initialKey;
            state.selectedSlotId = null;
            render();
          }
        }

        // Step 2 — slot-dependency flag (explicit arg wins over picker's)
        var slotDependencyFlag =
          (linkOptions.slotDependency != null
            ? linkOptions.slotDependency
            : false) ||
          (picker && picker._slotDependency);

        if (!slotDependencyFlag) return;

        var lookAheadDays = linkOptions.lookAheadDays || 60;

        // Disable dates with zero slots inside the picker
        if (typeof picker._injectBeforeShowDay === "function") {
          picker._injectBeforeShowDay(function (dateObj) {
            return dateHasAvailableSlots(dateObj.dateKey);
          });
        }

        function findNextDateWithSlots() {
          var start = todayKey();
          for (var i = 0; i <= lookAheadDays; i++) {
            var candidate = AbCore.addDays(start, i);
            if (dateHasAvailableSlots(candidate)) return candidate;
          }
          return null;
        }

        state.onRenderHook = function (hasSlots) {
          if (hasSlots || state.isAdvancing) return;
          var next = findNextDateWithSlots();
          if (!next) return;

          state.isAdvancing = true;
          if (typeof picker._selectDate === "function")
            picker._selectDate(next);
          setTimeout(function () {
            state.isAdvancing = false;
          }, 0);
        };

        setTimeout(function () {
          if (state.onRenderHook) {
            state.onRenderHook(
              state.currentDateKey
                ? dateHasAvailableSlots(state.currentDateKey)
                : false,
            );
          }
        }, 0);
      },
    };
  }

  global.AbTimeslot = {
    init: createTimeslotInstance,
    version: "2.1.0",
  };
})(window);
