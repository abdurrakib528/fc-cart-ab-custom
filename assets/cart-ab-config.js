window.AbCartConfig = {
  datepicker: {
    blockedDates: [
      "28-02-2026",
      "29-02-2026",
      "12-05-2024",
      "05-06-2024",
      "06-06-2024",
    ],

    blockedRanges: [{ start: "2026-02-01", end: "2026-02-15" }],

    dateClasses: [
      { date: "20-05-2024", class: "ab-tag-mday" },
      { date: "14-02-2020", class: "ab-tag-vday" },
      { start: "14-05-2026", end: "19-05-2026", class: "ab-tag-peak" },
    ],

    rules: [
      function blockSpecialProductDates({ date }) {
        const datesArr = [
          "08-05-2024",
          "09-05-2024",
          "10-05-2024",
          "11-05-2024",
        ];
        const cartTags = readCurrentCartItemTags();
        const tag = cartTags.everyItemHasTag("mday2026");
        const specialProduct = !cartTags.isCartEmpty && !tag;
        if (!specialProduct) return;
        if (datesArr.includes(date)) return false;
      },

      function blockSameDayIfTagged({ isToday }) {
        if (!isToday) return;
        const noSameday = readCurrentCartItemTags().anyItemHasTag("no-sameday");
        if (!noSameday) return;
        return false;
      },

      function blockAllSaturdays({ dow }) {
        const noSaturday = readCurrentCartItemTags().anyItemHasTag(
          "no-saturdays",
          "no-saturday",
        );
        if (!noSaturday) return;
        if (dow === 6) return false;
      },

      function blockAllSundays({ dow }) {
        const noSunday = readCurrentCartItemTags().anyItemHasTag(
          "no-sundays",
          "no-sunday",
        );
        if (!noSunday) return;
        if (dow === 0) return false;
      },
    ],
  },

  timeslot: {
    slots: [
      {
        id: "9am_1pm",
        open: true,
        label: "Morning",
        timeRange: "9am – 1pm",
        displayText: "between 9am and 1pm",
        prevdayCutoff: "17:00",
      },
      {
        id: "1pm_6pm",
        open: true,
        label: "Afternoon",
        timeRange: "1pm – 6pm",
        displayText: "between 1pm and 6pm",
        samedayCutoff: "14:00",
      },
      {
        id: "6pm_9pm",
        open: true,
        label: "Evening",
        timeRange: "6pm – 9pm",
        displayText: "between 6pm and 9pm",
        samedayCutoff: "17:00",
      },
      {
        id: "9am_6pm",
        open: true,
        label: "Standard",
        timeRange: "9am – 6pm",
        displayText: "between 9am and 6pm",
        samedayCutoff: "16:00",
      },
      {
        id: "express",
        open: true,
        label: "Express",
        timeRange: "Next 90 mins",
        displayText: "Express delivery (next 90 mins)",
        samedayCutoff: "16:00",
      },
    ],

    blockSlots: ["9am_6pm"],

    blockSlotsByDate: {
      "26-02-2026": {
        "9am_1pm": { samedayCutoff: "23:00" },
        "1pm_6pm": { samedayCutoff: "12:00" },
        "6pm_9pm": false,
        express: "unavailable",
      },
      "14-05-2024": {
        "9am_1pm": { samedayCutoff: "23:00" },
      },
      "14-05-2024": {
        "9am_1pm": { prevdayCutoff: "23:00" },
      },
      "14-05-2024": {
        "6pm_9pm": false,
      },
      "14-05-2026": {
        "9am_1pm": "unavailable",
      },
    },

    weekdayRules: {
      sunday: { "6pm_9pm": false, express: false },
      saturday: { express: false },
    },

    rules: [
      function expressSlotVisibility({ slot, isToday, now }) {
        if (slot.id !== "express") return;
        if (!isToday) return false;
        if (now < "10:00") return false;
        const cartTags = readCurrentCartItemTags();
        if (cartTags.isCartEmpty) return;
        if (!cartTags.everyItemHasTag("express")) return false;
      },
    ],
  },
};

/* -------------------------------------------------------------------------
 * Merchant-settings merge layer
 * ----------------------------------------------------------------------- */
(function applyMerchantSettings() {
  const merchant = window.AbCartMerchantConfig;
  if (!merchant) return;

  const config = window.AbCartConfig;

  // "15-06-2018, 18-06-2018" → ["15-06-2018", "18-06-2018"]
  const parseDates = (raw) =>
    String(raw || "")
      .split(",")
      .map((token) => token.trim())
      .filter((token) => /^\d{2}-\d{2}-\d{4}$/.test(token));

  if (merchant.disableDelivery?.enabled) {
    config.datepicker.blockedDates.push(
      ...parseDates(merchant.disableDelivery.datesRaw),
    );
  }

  // 9am–6pm slot is globally hidden; reveal it only on listed dates.
  if (merchant.timeslot9to6?.enabled) {
    const allowed = parseDates(merchant.timeslot9to6.datesRaw);
    if (allowed.length) {
      config.timeslot.blockSlots = config.timeslot.blockSlots.filter(
        (id) => id !== "9am_6pm",
      );
      config.timeslot.rules.push(({ slot, date }) => {
        if (slot.id === "9am_6pm" && !allowed.includes(date)) return false;
      });
    }
  }
})();
