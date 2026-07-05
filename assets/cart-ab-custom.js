class CartUpdatedEvent extends CustomEvent {
  constructor(cartData, sectionId, meta) {
    super("cart:updated", {
      bubbles: true,
      detail: {
        cartData,
        sectionId,
        source: meta.source,
        wasRemoval: meta.wasRemoval ?? false,
        changedVariantIds: meta.changedVariantIds ?? [],
      },
    });
  }
}

/** Fired when the message-card slidedown panel should toggle. */
class MessageCardToggledEvent extends CustomEvent {
  constructor(hasCardSelected) {
    super("cart:message-card-toggled", {
      bubbles: true,
      detail: { hasCardSelected },
    });
  }
}

/** Fired when a cart write fails. */
class CartErrorEvent extends CustomEvent {
  constructor(error, source) {
    super("cart:error", {
      bubbles: true,
      detail: { error, source },
    });
  }
}

function getShopifyRootPath() {
  return window.Shopify?.routes?.root || "/";
}
function buildCartFetchConfig(bodyObject) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(bodyObject),
  };
}

function debounce(fn, waitMs) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), waitMs);
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function startViewTransitionIfSupported(callback) {
  if (typeof document.startViewTransition === "function") {
    return document.startViewTransition(callback);
  }
  callback();
  return null;
}

function parseHtmlFragment(htmlString) {
  const template = document.createElement("template");
  template.innerHTML = htmlString;
  return template.content;
}

function readCurrentCartItemTags() {
  const tagListsPerItem = [
    ...document.querySelectorAll(".ab-cart__item[data-cart-tags]"),
  ].map((el) => el.dataset.cartTags.split(",").map((s) => s.trim()));

  // Flatten args — accepts ("tag"), ("a", "b"), or (["a", "b"])
  const normalize = (args) => args.flat();

  return {
    isCartEmpty: !tagListsPerItem.length,
    // True if ANY cart item has ANY of the supplied tags
    anyItemHasTag: (...tags) => {
      const want = normalize(tags);
      return tagListsPerItem.some((itemTags) =>
        want.some((t) => itemTags.includes(t)),
      );
    },
    // True if EVERY cart item has at least one of the supplied tags
    everyItemHasTag: (...tags) => {
      const want = normalize(tags);
      return (
        tagListsPerItem.length > 0 &&
        tagListsPerItem.every((itemTags) =>
          want.some((t) => itemTags.includes(t)),
        )
      );
    },
  };
}

let cartWritePromiseChain = Promise.resolve();

function enqueueCartWriteOperation(asyncFn) {
  const nextLink = cartWritePromiseChain.then(asyncFn, asyncFn);
  cartWritePromiseChain = nextLink.catch(() => {});
  return nextLink;
}

async function awaitAllPendingCartWrites() {
  try {
    await cartWritePromiseChain;
  } catch {
    console.log("chain failures are expected — we just want to know it's idle");
  }
}

function postToShopifyCartEndpoint(
  endpoint,
  body,
  { maxRetryAttempts = 3 } = {},
) {
  return enqueueCartWriteOperation(async () => {
    let lastTransientError;
    for (
      let attemptIndex = 0;
      attemptIndex < maxRetryAttempts;
      attemptIndex++
    ) {
      const response = await fetch(
        `${getShopifyRootPath()}${endpoint}`,
        buildCartFetchConfig(body),
      );
      const responseText = await response.text();

      let parsedPayload;
      try {
        parsedPayload = JSON.parse(responseText);
      } catch {
        throw new Error(
          `${endpoint} returned non-JSON (HTTP ${response.status})`,
        );
      }

      return parsedPayload;
    }
    throw lastTransientError;
  });
}

const SectionRenderer = {
  renderCartSummarySection(
    sectionId,
    sectionHtml,
    { useViewTransition = false } = {},
  ) {
    if (!sectionHtml) return;

    const incomingFragment = parseHtmlFragment(sectionHtml);
    const incomingSummary = incomingFragment.querySelector(".ab-cart__summary");
    const incomingWrapper = incomingFragment.querySelector(
      `#shopify-section-${sectionId}`,
    );
    const cartElement = document.querySelector(
      `ab-cart[data-section-id="${sectionId}"]`,
    );
    const currentSummary = cartElement?.querySelector(".ab-cart__summary");
    const currentWrapper = document.getElementById(
      `shopify-section-${sectionId}`,
    );

    const performReplacement = () => {
      const isEmptyStateTransition =
        currentWrapper && (!currentSummary || !incomingSummary);
      if (isEmptyStateTransition) {
        if (incomingWrapper)
          currentWrapper.innerHTML = incomingWrapper.innerHTML;
        return;
      }
      if (currentSummary && incomingSummary) {
        currentSummary.innerHTML = incomingSummary.innerHTML;
      }
    };

    if (useViewTransition) startViewTransitionIfSupported(performReplacement);
    else performReplacement();
  },

  renderHeaderCartIconBubble(headerHtml) {
    if (!headerHtml) return;
    const incomingBubble =
      parseHtmlFragment(headerHtml).querySelector(".cart_count");
    if (!incomingBubble) return;
    const newCount = incomingBubble.innerHTML;
    document.querySelectorAll(".cart_count").forEach((bubble) => {
      bubble.innerHTML = newCount;
    });
  },

  renderAllSectionsFromCartResponse(
    sectionId,
    cartData,
    { useViewTransition = false } = {},
  ) {
    if (!cartData?.sections) return;
    this.renderCartSummarySection(sectionId, cartData.sections[sectionId], {
      useViewTransition,
    });
    this.renderHeaderCartIconBubble(cartData.sections.header_new);
  },
};


/* <ab-cart> */
class AbCart extends HTMLElement {
  constructor() {
    super();
    this.sectionId = this.dataset.sectionId;
    this.qtyButtonDebounceTimers = new Map();
    this.isCheckoutSubmissionInFlight = false;
    this.addEventListener("click", (event) =>
      this.handleCartContainerClick(event),
    );
    this.addEventListener(
      "change",
      debounce((event) => this.handleQtyInputChange(event), 300),
    );
    this.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    this.addEventListener(
      "click",
      (event) => this.handleCheckoutCaptureClick(event),
      true,
    );
  }

  disconnectedCallback() {
    this.qtyButtonDebounceTimers.forEach(clearTimeout);
    this.qtyButtonDebounceTimers.clear();
  }

  async updateLineQuantity(lineKey, newQuantity, originatingElement) {
    if (!lineKey) return null;
    const integerQuantity = parseInt(newQuantity, 10) || 0;

    this.markLineAsUpdating(lineKey, originatingElement);

    try {
      const cartData = await postToShopifyCartEndpoint("cart/change.js", {
        id: lineKey,
        quantity: integerQuantity,
        sections: `${this.sectionId},header_new`,
        sections_url: window.location.pathname,
      });

      SectionRenderer.renderAllSectionsFromCartResponse(
        this.sectionId,
        cartData,
      );
      document.dispatchEvent(
        new CartUpdatedEvent(cartData, this.sectionId, {
          source: "ab-cart",
          wasRemoval: integerQuantity === 0,
        }),
      );
      return cartData;
    } catch (err) {
      console.error("[ab-cart] updateLineQuantity failed:", err);
      document.dispatchEvent(new CartErrorEvent(err, "ab-cart"));
      this.unmarkLineAsUpdating(lineKey, originatingElement);
      return null;
    }
  }

  removeLineItem(lineKey, originatingElement) {
    return this.updateLineQuantity(lineKey, 0, originatingElement);
  }

  markLineAsUpdating(lineKey, originatingElement) {
    const lineElement =
      originatingElement?.closest(".ab-cart__item") ||
      this.querySelector(`[data-key="${lineKey}"]`)?.closest(".ab-cart__item");
    lineElement
      ?.querySelector(".ab-cart__item-price")
      ?.classList.add("is-updating");
    this.querySelector(".ab-cart__items-list")?.classList.add("is-busy");
    this.querySelector(".ab-cart__total-val")?.classList.add("is-updating");
  }

  unmarkLineAsUpdating(lineKey, originatingElement) {
    const lineElement =
      originatingElement?.closest(".ab-cart__item") ||
      this.querySelector(`[data-key="${lineKey}"]`)?.closest(".ab-cart__item");
    lineElement
      ?.querySelector(".ab-cart__item-price")
      ?.classList.remove("is-updating");
    this.querySelector(".ab-cart__items-list")?.classList.remove("is-busy");
    this.querySelector(".ab-cart__total-val")?.classList.remove("is-updating");
  }

  clearAllCartItems(originatingButton) {
    originatingButton?.classList.add("is-loading");

    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${getShopifyRootPath()}cart/update`;

    const allLineKeys = new Set(
      [...this.querySelectorAll("[data-key]")]
        .map((el) => el.dataset.key)
        .filter(Boolean),
    );
    allLineKeys.forEach((lineKey) => {
      const updateInput = document.createElement("input");
      updateInput.type = "hidden";
      updateInput.name = `updates[${lineKey}]`;
      updateInput.value = "0";
      form.appendChild(updateInput);
    });

    document.body.appendChild(form);
    form.submit();
  }

  handleCartContainerClick(event) {
    if (this.handleClearButtonClick(event)) return;
    if (this.handleQtyButtonClick(event)) return;
    if (this.handleRemoveButtonClick(event)) return;
    if (this.handleMessagePillClick(event)) return;
  }

  handleClearButtonClick(event) {
    const clearButton = event.target.closest("[data-cart-clear]");
    if (!clearButton) return false;
    event.preventDefault();

    this.showConfirmationPopup({
      title: "Clear all items from your cart? This action cannot be undone.",
      continueLabel: "Yes",
      cancelLabel: "No",
      onContinue: () => this.clearAllCartItems(clearButton),
      onCancel: () => {},
    });
    return true;
  }

  handleQtyButtonClick(event) {
    const qtyButton = event.target.closest("[data-action]");
    if (!qtyButton) return false;
    event.preventDefault();

    const qtyInput = qtyButton.parentElement.querySelector(
      ".ab-cart__qty-input",
    );
    if (!qtyInput) return true;

    const currentValue = parseInt(qtyInput.value, 10);
    const safeValue = Number.isFinite(currentValue) ? currentValue : 0;
    const nextValue =
      safeValue + (qtyButton.dataset.action === "plus" ? 1 : -1);
    if (nextValue < 0) return true;

    qtyInput.value = nextValue;
    this.scheduleQtyButtonClickUpdate(
      qtyButton.dataset.key,
      nextValue,
      qtyButton,
    );
    return true;
  }

  handleRemoveButtonClick(event) {
    const removeButton = event.target.closest(".ab-cart__item-remove");
    if (!removeButton) return false;
    event.preventDefault();

    const lineKey = removeButton.dataset.key;

    const pendingTimer = this.qtyButtonDebounceTimers.get(lineKey);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.qtyButtonDebounceTimers.delete(lineKey);
    }

    this.removeLineItem(lineKey, removeButton);
    return true;
  }

  handleMessagePillClick(event) {
    const pillButton = event.target.closest(".ab-cart__pill");
    if (!pillButton) return false;
    event.preventDefault();

    const contentElement = pillButton.nextElementSibling;
    const textareaElement = this.querySelector(".ab-cart__textarea");
    if (
      textareaElement &&
      contentElement?.classList.contains("ab-cart__pill-content")
    ) {
      textareaElement.value = contentElement.innerHTML;
      textareaElement.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  handleQtyInputChange(event) {
    if (!event.target.classList.contains("ab-cart__qty-input")) return;
    const parsedValue = parseInt(event.target.value, 10);
    const safeValue =
      Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
    this.updateLineQuantity(event.target.dataset.key, safeValue, event.target);
  }

  scheduleQtyButtonClickUpdate(lineKey, newQuantity, originatingButton) {
    if (!lineKey) return;
    this.markLineAsUpdating(lineKey, originatingButton);
    clearTimeout(this.qtyButtonDebounceTimers.get(lineKey));
    this.qtyButtonDebounceTimers.set(
      lineKey,
      setTimeout(() => {
        this.qtyButtonDebounceTimers.delete(lineKey);
        this.updateLineQuantity(lineKey, newQuantity, originatingButton);
      }, 40),
    );
  }

  handleCheckoutCaptureClick(event) {
    const checkoutButton = event.target?.closest?.('[name="checkout"]');
    if (!checkoutButton || !this.contains(checkoutButton)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.handleCheckoutSubmission();
  }

  setCheckoutButtonsLoadingState(isLoading) {
    this.querySelectorAll('[name="checkout"]').forEach((btn) =>
      btn.classList.toggle("is-loading", isLoading),
    );
  }

  async handleCheckoutSubmission() {
    if (this.isCheckoutSubmissionInFlight) return;
    this.isCheckoutSubmissionInFlight = true;

    try {
      document.querySelectorAll("ab-addon-picker").forEach((picker) => {
        picker.flushPendingMultiSelectBatch?.();
      });
      await awaitAllPendingCartWrites();

      if (!this.validateCartContentsBeforeCheckout()) {
        this.isCheckoutSubmissionInFlight = false;
        return;
      }

      this.setCheckoutButtonsLoadingState(true);
      this.proceedWithCheckoutSubmission();
    } catch (err) {
      console.error("[ab-cart] checkout error:", err);
      this.setCheckoutButtonsLoadingState(false);
      this.isCheckoutSubmissionInFlight = false;
    }
  }

  validateCartContentsBeforeCheckout() {
    const cartTags = readCurrentCartItemTags();
    if (!cartTags.isCartEmpty && cartTags.everyItemHasTag("addon")) {
      this.showConfirmationPopup({
        title:
          "Please select at least one non-addon product to proceed to checkout.",
        continueLabel: "OK",
        singleAction: true,
        onContinue: () => {},
      });
      return false;
    }

    const messageCardPicker = document.querySelector(
      'ab-addon-picker[data-addon-type="message-card"]',
    );
    const hasCardSelected = messageCardPicker?.querySelector(
      ".ab-cart__card-item.is-selected",
    );
    const messageTextarea = document.querySelector(".card-message-textarea");
    const messageIsEmpty = !messageTextarea || !messageTextarea.value.trim();

    if (messageCardPicker && !hasCardSelected) {
      this.showConfirmationPopup({
        title:
          "You have not selected a Greeting Card. Do you want to proceed without a Greeting Card?",
        onContinue: () => this.proceedWithCheckoutSubmission(),
        onCancel: () =>
          this.highlightAddonRowAsValidationError(messageCardPicker),
      });
      return false;
    }

    if (hasCardSelected && messageIsEmpty) {
      this.showConfirmationPopup({
        title: "Do you want to proceed with an empty message card?",
        onContinue: () => this.proceedWithCheckoutSubmission(),
        onCancel: () =>
          this.highlightTextareaAsValidationError(messageTextarea),
      });
      return false;
    }

    return true;
  }

  proceedWithCheckoutSubmission() {
    const formElement = this.querySelector("form");
    if (!formElement) return;
    this.setCheckoutButtonsLoadingState(true);
    formElement.submit();
  }

  highlightAddonRowAsValidationError(addonPicker) {
    const row = addonPicker?.closest(".ab-cart__row");
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("ab-cart__row--error");
    setTimeout(() => row.classList.remove("ab-cart__row--error"), 4000);
  }

  highlightTextareaAsValidationError(textarea) {
    if (!textarea) return;
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.classList.add("ab-cart__textarea--error");
    textarea.focus();
    setTimeout(
      () => textarea.classList.remove("ab-cart__textarea--error"),
      4000,
    );
  }

  showConfirmationPopup({
    title,
    onContinue,
    onCancel,
    continueLabel = "Continue",
    cancelLabel = "Cancel",
    singleAction = false,
  }) {
    this.dismissConfirmationPopup();

    const overlayElement = document.createElement("div");
    overlayElement.className = "ab-cart-popup-overlay";

    const actionsHtml = singleAction
      ? `<button type="button" class="ab-cart-popup__btn ab-cart-popup__btn--continue">${continueLabel}</button>`
      : `<button type="button" class="ab-cart-popup__btn ab-cart-popup__btn--cancel">${cancelLabel}</button>
         <button type="button" class="ab-cart-popup__btn ab-cart-popup__btn--continue">${continueLabel}</button>`;

    overlayElement.innerHTML = `
      <div class="ab-cart-popup">
        <div class="ab-cart-popup__icon">
          ${(window.AB_ICONS && window.AB_ICONS["warning-triangle"]) || ""}
        </div>
        <p class="ab-cart-popup__title">${title}</p>
        <div class="ab-cart-popup__actions">
          ${actionsHtml}
        </div>
      </div>
    `;
    document.body.appendChild(overlayElement);
    requestAnimationFrame(() =>
      overlayElement.classList.add("is-popup-visible"),
    );

    const finishWithCallback = (callback) => {
      this.dismissConfirmationPopup();
      callback?.();
    };
    overlayElement
      .querySelector(".ab-cart-popup__btn--continue")
      .addEventListener("click", () => finishWithCallback(onContinue));

    const cancelBtn = overlayElement.querySelector(
      ".ab-cart-popup__btn--cancel",
    );
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => finishWithCallback(onCancel));
    }

    overlayElement.addEventListener("click", (event) => {
      if (event.target === overlayElement) {
        // For single-action popups, backdrop click acts as the dismiss
        finishWithCallback(singleAction ? onContinue : onCancel);
      }
    });
  }

  dismissConfirmationPopup() {
    const existingOverlay = document.querySelector(".ab-cart-popup-overlay");
    if (!existingOverlay) return;
    existingOverlay.classList.remove("is-popup-visible");
    setTimeout(() => {
      if (existingOverlay.isConnected) existingOverlay.remove();
    }, 350);
  }
}

/* <ab-addon-picker> */

class AbAddonPicker extends HTMLElement {
  constructor() {
    super();
    this.sectionId = this.dataset.sectionId;
    this.selectionMode = this.dataset.selectionMode || "single";
    this.addonType = this.dataset.addonType;

    this.selectedVariantIds = new Set(
      (this.dataset.activeVariants || "")
        .split(",")
        .map((v) => parseInt(v, 10))
        .filter(Boolean),
    );

    this.previousSingleVariantId =
      this.selectionMode === "single" && this.selectedVariantIds.size > 0
        ? [...this.selectedVariantIds][0]
        : null;

    this.variantsBeingProcessed = new Set();

    this.pendingMultiSelectUpdates = {};

    this.multiSelectBatchTimer = null;

    this.multiSelectBatchInFlight = null;

    this.isCardListExpanded = false;

    this.addEventListener("click", (event) =>
      this.handleAddonPickerClick(event),
    );
    this.addEventListener("keydown", (event) =>
      this.handleAddonPickerKeydown(event),
    );
  }

  connectedCallback() {
    this.cartUpdateHandler = (event) => this.handleExternalCartUpdate(event);
    document.addEventListener("cart:updated", this.cartUpdateHandler);

    this.windowResizeHandler = debounce(
      () => this.applyContainerMaxHeight(),
      100,
    );
    window.addEventListener("resize", this.windowResizeHandler, {
      passive: true,
    });

    this.recalculateCardVisibility();
    this.initializeFilterTabs();
    this.updateAddonStepComplete();
    this.synchronizeSelectionsWithLiveCart();

    requestAnimationFrame(() => {
      this.querySelector(".ab-cart__card-grid")?.classList.add(
        "has-slide-animation",
      );
    });
  }

  disconnectedCallback() {
    document.removeEventListener("cart:updated", this.cartUpdateHandler);
    if (this.windowResizeHandler)
      window.removeEventListener("resize", this.windowResizeHandler);
    if (this.multiSelectBatchTimer) clearTimeout(this.multiSelectBatchTimer);
    this.tabsResizeObserver?.disconnect();
    if (this.tabsResizeListener)
      window.removeEventListener("resize", this.tabsResizeListener);
  }

  flushPendingMultiSelectBatch() {
    if (this.multiSelectBatchTimer) {
      clearTimeout(this.multiSelectBatchTimer);
      this.multiSelectBatchTimer = null;
      this.executeMultiSelectBatchWrite();
    }
  }

  findAllCardElements() {
    return [...this.querySelectorAll(".ab-cart__card-item[data-variant-id]")];
  }
  findCardElementByVariant(variantId) {
    return this.querySelector(
      `.ab-cart__card-item[data-variant-id="${variantId}"]`,
    );
  }

  applyOptimisticCardSelection(card, variantId, isSelected) {
    if (!card) return;
    card.classList.toggle("is-selected", isSelected);
    if (isSelected) this.selectedVariantIds.add(variantId);
    else this.selectedVariantIds.delete(variantId);
    // Step tick is intentionally NOT updated here — callers update it after
    // the server response settles so the check reflects committed cart state.
  }

  updateAddonStepComplete() {
    const stepEl = this.closest(".ab-cart__row")?.querySelector(
      ".ab-cart__step",
    );
    if (!stepEl) return;
    stepEl.classList.toggle("is-complete", this.selectedVariantIds.size > 0);
  }

  applyDimmedStateToOtherCards(activeCard, shouldDim) {
    if (this.selectionMode === "multiple") return;
    this.findAllCardElements().forEach((c) => {
      if (c !== activeCard) c.classList.toggle("is-dimmed", shouldDim);
    });
  }

  applyShimmerToCartSubtotal(isShimmering) {
    document
      .querySelector(`ab-cart[data-section-id="${this.sectionId}"]`)
      ?.querySelector(".ab-cart__total-val")
      ?.classList.toggle("is-updating", isShimmering);
  }

  handleAddonPickerClick(event) {
    const tabsArrowButton = event.target.closest("[data-tabs-arrow]");
    if (tabsArrowButton) {
      event.preventDefault();
      return this.scrollFilterTabsByArrow(tabsArrowButton);
    }

    const filterTabButton = event.target.closest("[data-tab-filter]");
    if (filterTabButton) {
      event.preventDefault();
      return this.activateFilterTab(filterTabButton);
    }

    const showMoreButton = event.target.closest("[data-show-toggle]");
    if (showMoreButton) {
      event.preventDefault();
      return this.toggleShowMoreLessCards();
    }

    if (
      event.target.closest(
        ".ab-cart__card-popup-icon, [data-quick-view-trigger]",
      )
    )
      return;

    const cardElement = event.target.closest(
      ".ab-cart__card-item[data-variant-id]",
    );
    if (!cardElement) return;

    const variantId = parseInt(cardElement.dataset.variantId, 10);
    if (!variantId) return;
    if (this.variantsBeingProcessed.has(variantId)) return;
    if (this.selectionMode === "single" && this.variantsBeingProcessed.size > 0)
      return;

    this.togglePickerCardSelection(cardElement, variantId);
  }

  handleAddonPickerKeydown(event) {
    if (!event.target.closest("[data-tab-filter]")) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const allTabs = [...this.querySelectorAll("[data-tab-filter]")];
    if (allTabs.length === 0) return;
    const lastIdx = allTabs.length - 1;
    const currentIdx = allTabs.indexOf(event.target);
    if (currentIdx === -1) return;

    let nextIdx = currentIdx;
    switch (event.key) {
      case "ArrowLeft":
        nextIdx = currentIdx === 0 ? lastIdx : currentIdx - 1;
        break;
      case "ArrowRight":
        nextIdx = currentIdx === lastIdx ? 0 : currentIdx + 1;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = lastIdx;
        break;
    }

    event.preventDefault();
    allTabs[nextIdx].focus({ preventScroll: true });
    this.activateFilterTab(allTabs[nextIdx]);
  }

  async synchronizeSelectionsWithLiveCart() {
    try {
      const response = await fetch(`${getShopifyRootPath()}cart.js`, {
        headers: { Accept: "application/json" },
      });
      const liveCart = await response.json();
      const liveVariantIds = new Set(liveCart.items.map((i) => i.variant_id));

      for (const vid of [...this.selectedVariantIds]) {
        if (!liveVariantIds.has(vid)) {
          this.applyOptimisticCardSelection(
            this.findCardElementByVariant(vid),
            vid,
            false,
          );
        }
      }
      this.findAllCardElements().forEach((card) => {
        const vid = parseInt(card.dataset.variantId, 10);
        if (liveVariantIds.has(vid) && !this.selectedVariantIds.has(vid)) {
          this.applyOptimisticCardSelection(card, vid, true);
        }
      });
      this.updateAddonStepComplete();
    } catch {}
  }

  handleExternalCartUpdate(event) {
    if (event.detail?.source === "ab-addon-picker") return;
    if (event.detail?.sectionId && event.detail.sectionId !== this.sectionId)
      return;

    const liveVariantIds = new Set(
      (event.detail?.cartData?.items || []).map((i) => i.variant_id),
    );
    for (const vid of [...this.selectedVariantIds]) {
      if (liveVariantIds.has(vid)) continue;
      if (this.variantsBeingProcessed.has(vid)) continue;
      if (String(vid) in this.pendingMultiSelectUpdates) continue;
      this.applyOptimisticCardSelection(
        this.findCardElementByVariant(vid),
        vid,
        false,
      );
    }
    this.updateAddonStepComplete();
  }

  async togglePickerCardSelection(cardElement, variantId) {
    const wasPreviouslySelected = cardElement.classList.contains("is-selected");
    const previousSingleId =
      this.selectionMode === "single" ? this.previousSingleVariantId : null;

    // 1. Optimistic UI flip
    if (wasPreviouslySelected) {
      this.applyOptimisticCardSelection(cardElement, variantId, false);
    } else {
      if (this.selectionMode === "single") {
        this.findAllCardElements().forEach((c) =>
          c.classList.remove("is-selected"),
        );
        this.selectedVariantIds.clear();
      }
      this.applyOptimisticCardSelection(cardElement, variantId, true);
    }

    this.variantsBeingProcessed.add(variantId);
    cardElement.classList.add("is-loading");
    cardElement.dataset.loadingState = wasPreviouslySelected
      ? "removing"
      : "adding";

    this.applyShimmerToCartSubtotal(true);

    if (this.selectionMode === "multiple") {
      this.pendingMultiSelectUpdates[variantId] = wasPreviouslySelected ? 0 : 1;
      clearTimeout(this.multiSelectBatchTimer);
      this.multiSelectBatchTimer = setTimeout(() => {
        this.multiSelectBatchTimer = null;
        this.executeMultiSelectBatchWrite();
      }, 15);
      return;
    }

    this.applyDimmedStateToOtherCards(cardElement, true);
    try {
      const updatesBody = wasPreviouslySelected
        ? { [variantId]: 0 }
        : {
            ...(previousSingleId && previousSingleId !== variantId
              ? { [previousSingleId]: 0 }
              : {}),
            [variantId]: 1,
          };

      const cartData = await postToShopifyCartEndpoint("cart/update.js", {
        updates: updatesBody,
        sections: `${this.sectionId},header_new`,
        sections_url: window.location.pathname,
      });

      this.previousSingleVariantId = wasPreviouslySelected ? null : variantId;

      SectionRenderer.renderAllSectionsFromCartResponse(
        this.sectionId,
        cartData,
      );
      document.dispatchEvent(
        new CartUpdatedEvent(cartData, this.sectionId, {
          source: "ab-addon-picker",
          wasRemoval: wasPreviouslySelected,
          changedVariantIds: [variantId],
        }),
      );

      if (this.addonType === "message-card") {
        document.dispatchEvent(
          new MessageCardToggledEvent(!wasPreviouslySelected),
        );
      }
    } catch (err) {
      console.error("[ab-addon-picker] single-mode toggle failed:", err);
      this.applyOptimisticCardSelection(
        cardElement,
        variantId,
        wasPreviouslySelected,
      ); // revert
      document.dispatchEvent(new CartErrorEvent(err, "ab-addon-picker"));
    } finally {
      cardElement.classList.remove("is-loading");
      delete cardElement.dataset.loadingState;
      this.applyDimmedStateToOtherCards(cardElement, false);
      this.variantsBeingProcessed.delete(variantId);
      this.applyShimmerToCartSubtotal(false);
      this.updateAddonStepComplete();
    }
  }

  async executeMultiSelectBatchWrite() {
    if (this.multiSelectBatchInFlight) return;

    const updatesBody = this.pendingMultiSelectUpdates;
    this.pendingMultiSelectUpdates = {};
    if (!Object.keys(updatesBody).length) return;

    const variantIdsInBatch = Object.keys(updatesBody).map(Number);

    try {
      this.multiSelectBatchInFlight = postToShopifyCartEndpoint(
        "cart/update.js",
        {
          updates: updatesBody,
          sections: `${this.sectionId},header_new`,
          sections_url: window.location.pathname,
        },
      );
      const cartData = await this.multiSelectBatchInFlight;
      const wasRemoval = Object.values(updatesBody).some((v) => v === 0);

      SectionRenderer.renderAllSectionsFromCartResponse(
        this.sectionId,
        cartData,
      );
      document.dispatchEvent(
        new CartUpdatedEvent(cartData, this.sectionId, {
          source: "ab-addon-picker",
          wasRemoval,
          changedVariantIds: variantIdsInBatch,
        }),
      );
    } catch (err) {
      console.error("[ab-addon-picker] multi-select batch failed:", err);

      variantIdsInBatch.forEach((vid) =>
        this.applyOptimisticCardSelection(
          this.findCardElementByVariant(vid),
          vid,
          updatesBody[vid] === 0,
        ),
      );
      document.dispatchEvent(new CartErrorEvent(err, "ab-addon-picker"));
    } finally {
      variantIdsInBatch.forEach((vid) => {
        const card = this.findCardElementByVariant(vid);
        if (card) {
          card.classList.remove("is-loading");
          delete card.dataset.loadingState;
        }
        this.variantsBeingProcessed.delete(vid);
      });
      this.multiSelectBatchInFlight = null;

      if (Object.keys(this.pendingMultiSelectUpdates).length) {
        this.executeMultiSelectBatchWrite();
      } else {
        this.applyShimmerToCartSubtotal(false);
        this.updateAddonStepComplete();
      }
    }
  }

  initializeFilterTabs() {
    const tabsContainer = this.querySelector("[data-addon-tabs]");
    if (!tabsContainer) return;

    const indicator = tabsContainer.querySelector(".ab-cart__tab-indicator");
    const activeTab = tabsContainer.querySelector(
      ".ab-cart__tab-btn.is-active",
    );
    if (indicator && activeTab) {
      indicator.style.transition = "none";
      this.repositionTabIndicator(indicator, activeTab, tabsContainer);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          indicator.style.transition = "";
        }),
      );
    }

    const outerContainer = tabsContainer.closest(".ab-cart__tabs-container");
    if (!outerContainer) return;

    const updateScrollIndicators = () => {
      outerContainer.classList.toggle(
        "can-scroll-left",
        tabsContainer.scrollLeft > 2,
      );
      outerContainer.classList.toggle(
        "can-scroll-right",
        tabsContainer.scrollLeft + tabsContainer.clientWidth <
          tabsContainer.scrollWidth - 2,
      );
    };
    tabsContainer.addEventListener("scroll", updateScrollIndicators, {
      passive: true,
    });

    this.tabsResizeListener = updateScrollIndicators;
    window.addEventListener("resize", this.tabsResizeListener, {
      passive: true,
    });

    if (window.ResizeObserver) {
      this.tabsResizeObserver = new ResizeObserver(updateScrollIndicators);
      this.tabsResizeObserver.observe(tabsContainer);
    }
    requestAnimationFrame(updateScrollIndicators);
    setTimeout(updateScrollIndicators, 50);
  }

  scrollFilterTabsByArrow(arrowButton) {
    const tabsContainer = this.querySelector("[data-addon-tabs]");
    if (!tabsContainer) return;
    const direction = arrowButton.dataset.tabsArrow === "prev" ? -1 : 1;

    const scrollAmount =
      Math.round(tabsContainer.clientWidth * 0.7) * direction;
    tabsContainer.scrollBy({ left: scrollAmount, behavior: "smooth" });
  }

  repositionTabIndicator(indicator, button, tabsContainer) {
    const containerRect = tabsContainer.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    Object.assign(indicator.style, {
      left: `${buttonRect.left - containerRect.left + tabsContainer.scrollLeft}px`,
      top: `${buttonRect.top - containerRect.top + tabsContainer.scrollTop}px`,
      width: `${buttonRect.width}px`,
      height: `${buttonRect.height}px`,
    });
  }

  activateFilterTab(tabButton) {
    const currentlyActive = this.querySelector("[data-tab-filter].is-active");
    if (currentlyActive === tabButton) return;

    this.querySelectorAll("[data-tab-filter]").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-pressed", "false");
    });
    tabButton.classList.add("is-active");
    tabButton.setAttribute("aria-pressed", "true");

    const tabsContainer = this.querySelector("[data-addon-tabs]");
    const indicator = tabsContainer?.querySelector(".ab-cart__tab-indicator");
    if (indicator && tabsContainer)
      this.repositionTabIndicator(indicator, tabButton, tabsContainer);

    tabButton.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });

    const filterHandle = tabButton.dataset.tabFilter;
    const cardElements = this.findAllCardElements();

    const applyFilterToCards = () => {
      cardElements.forEach((card) => {
        const cardTabTags = (card.dataset.tabTags || "").split(" ");
        const shouldShow =
          filterHandle === "all" || cardTabTags.includes(filterHandle);
        if (shouldShow) card.removeAttribute("data-tab-hidden");
        else card.setAttribute("data-tab-hidden", "");
      });
      this.isCardListExpanded = false;
      this.recalculateCardVisibility();
    };

    startViewTransitionIfSupported(applyFilterToCards);
  }

  toggleShowMoreLessCards() {
    this.isCardListExpanded = !this.isCardListExpanded;
    this.updateShowMoreToggleButton();

    const containingRow = this.closest(".ab-cart__row") || this;
    const cardsContainer = this.querySelector(".ab-cart__card-grid");

    if (this.isCardListExpanded) {
      this.applyContainerMaxHeight();
      const showMoreWrapper = this.querySelector(".ab-cart__show-more-wrapper");
      (showMoreWrapper || containingRow).scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    if (cardsContainer) cardsContainer.style.transition = "none";
    this.applyContainerMaxHeight();
    containingRow.scrollIntoView({ behavior: "smooth", block: "start" });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cardsContainer) cardsContainer.style.transition = "";
      });
    });
  }

  recalculateCardVisibility() {
    this.findAllCardElements().forEach((card) => {
      card.style.display = card.hasAttribute("data-tab-hidden") ? "none" : "";
    });
    this.applyContainerMaxHeight();
    this.updateShowMoreToggleButton();
  }

  detectCardsPerRow(visibleCards) {
    if (visibleCards.length < 2) return 1;
    const firstCardOffsetTop = visibleCards[0].offsetTop;
    let cardsInFirstRow = 1;
    for (let i = 1; i < visibleCards.length; i++) {
      if (visibleCards[i].offsetTop > firstCardOffsetTop) break;
      cardsInFirstRow++;
    }
    return cardsInFirstRow;
  }

  computeBaselineCardCount(visibleCards) {
    const isMobile = window.matchMedia("(max-width: 749px)").matches;
    const mobileRows = parseInt(this.dataset.mobileRows, 10);
    if (isMobile && Number.isFinite(mobileRows) && mobileRows > 0) {
      return this.detectCardsPerRow(visibleCards) * mobileRows;
    }
    const configured = parseInt(this.dataset.visibleCount, 10);
    if (Number.isFinite(configured) && configured > 0) return configured;
    return this.detectCardsPerRow(visibleCards) * 2;
  }

  applyContainerMaxHeight() {
    const cardsContainer = this.querySelector(".ab-cart__card-grid");
    if (!cardsContainer) return;

    const visibleCards = this.findAllCardElements().filter(
      (c) => !c.hasAttribute("data-tab-hidden"),
    );
    if (visibleCards.length === 0) {
      cardsContainer.style.maxHeight = "";
      return;
    }

    const baselineCardCount = this.computeBaselineCardCount(visibleCards);
    const needsClipping = visibleCards.length > baselineCardCount;

    if (!needsClipping) {
      cardsContainer.style.maxHeight = "";
      return;
    }

    if (this.isCardListExpanded) {
      cardsContainer.style.maxHeight = `${cardsContainer.scrollHeight}px`;
    } else {
      const lastBaselineCard = visibleCards[baselineCardCount - 1];
      const containerTop = cardsContainer.getBoundingClientRect().top;
      const lastCardBottom = lastBaselineCard.getBoundingClientRect().bottom;
      const collapsedHeight = lastCardBottom - containerTop;
      cardsContainer.style.maxHeight = `${collapsedHeight}px`;
    }
  }

  updateShowMoreToggleButton() {
    const showMoreToggleButton = this.querySelector("[data-show-toggle]");
    if (!showMoreToggleButton) return;

    const visibleCards = this.findAllCardElements().filter(
      (c) => !c.hasAttribute("data-tab-hidden"),
    );
    const baselineCardCount = this.computeBaselineCardCount(visibleCards);
    const wrapper = showMoreToggleButton.closest(".ab-cart__show-more-wrapper");
    if (wrapper)
      wrapper.style.display =
        visibleCards.length > baselineCardCount ? "" : "none";

    showMoreToggleButton.setAttribute(
      "aria-label",
      this.isCardListExpanded ? "Show less" : "Show more",
    );
    showMoreToggleButton.classList.toggle(
      "is-expanded",
      this.isCardListExpanded,
    );
  }
}

/* <ab-delivery-picker>  */

class AbDeliveryPicker extends HTMLElement {
  constructor() {
    super();
    this.datePicker = null;
    this.timeslotPicker = null;
    this.accentColor = this.dataset.accent;

    this.rememberedDateValue = "";
    this.rememberedSlotValue = "";
    this.rememberedDateLabel = "";
    this.rememberedSlotLabel = "";
  }

  get currentDateInput() {
    return document.querySelector("[data-delivery-date-input]");
  }
  get currentSlotInput() {
    return document.querySelector("[data-delivery-slot-input]");
  }

  restoreRememberedInputValues() {
    if (this.currentDateInput && this.rememberedDateValue) {
      this.currentDateInput.value = this.rememberedDateValue;
    }
    if (this.currentSlotInput && this.rememberedSlotValue) {
      this.currentSlotInput.value = this.rememberedSlotValue;
    }
    this.renderDeliveryNotice();
  }

  renderDeliveryNotice() {
    const noticeEl = document.querySelector("[data-delivery-notice]");
    const targetEl = document.querySelector("[data-delivery-notice-when]");
    if (!noticeEl || !targetEl) return;

    if (this.rememberedDateLabel && this.rememberedSlotLabel) {
      targetEl.textContent = `${this.rememberedDateLabel}, ${this.rememberedSlotLabel}`;
      noticeEl.hidden = false;
    } else {
      targetEl.textContent = "";
      noticeEl.hidden = true;
    }
  }

  updateDeliveryStepComplete() {
    const stepEl = document.querySelector(
      '.ab-cart__step[data-step-section="delivery"]',
    );
    if (!stepEl) return;
    const hasDate = !!this.currentDateInput?.value;
    const hasSlot = !!this.currentSlotInput?.value;
    stepEl.classList.toggle("is-complete", hasDate && hasSlot);
  }

  connectedCallback() {
    this.initializeDateAndTimeslotPickers();
    this.scheduleSkeletonReveal();

    this.rememberedDateValue =
      this.currentDateInput?.value || this.rememberedDateValue;
    this.rememberedSlotValue =
      this.currentSlotInput?.value || this.rememberedSlotValue;
    this.updateDeliveryStepComplete();

    this.cartUpdateHandler = (event) => {
      this.restoreRememberedInputValues();
      if (!event.detail?.wasRemoval) return;
      this.datePicker?.reload?.();
      this.timeslotPicker?.refresh?.();
    };
    document.addEventListener("cart:updated", this.cartUpdateHandler);
  }

  disconnectedCallback() {
    document.removeEventListener("cart:updated", this.cartUpdateHandler);
  }

  scheduleSkeletonReveal(minMs = 300) {
    const section = this.querySelector(".ab-datepicker-section");
    if (!section) return;
    setTimeout(() => section.classList.add("ab-ready"), minMs);
  }

  initializeDateAndTimeslotPickers() {
    if (this.datePicker) return;

    this.datePicker = AbDatepicker.init({
      daterowId: "ab-daterow",
      calendarId: "ab-calendar",
      clockId: "ab-clock",
      accent: this.accentColor,
      slotDependency: true,
      initialRender: true,
      blockedDates: window.AbCartConfig.datepicker.blockedDates,
      blockedRanges: window.AbCartConfig.datepicker.blockedRanges,
      onChange: ({ dateKey, dayofweek, day }) => {
        if (this.timeslotPicker) {
          this.timeslotPicker.setDate(dateKey);
        }
        this.rememberedDateValue = dateKey.split("-").reverse().join("/");
        this.rememberedDateLabel = `${dayofweek} ${day}`;
        if (this.currentDateInput) {
          this.currentDateInput.value = this.rememberedDateValue;
        }
        this.renderDeliveryNotice();
        this.updateDeliveryStepComplete();
      },
      rules: window.AbCartConfig.datepicker.rules,
      dateClasses: window.AbCartConfig.datepicker.dateClasses,
    });

    this.timeslotPicker = AbTimeslot.init({
      containerId: "ab-timeslots",
      accent: this.accentColor,
      noSlotsText: "No delivery slots available for this date.",
      slots: window.AbCartConfig.timeslot.slots,
      onChange: ({ slot }) => {
        this.rememberedSlotValue = slot.displayText;
        this.rememberedSlotLabel = slot.displayText;
        if (this.currentSlotInput) {
          this.currentSlotInput.value = this.rememberedSlotValue;
        }
        this.renderDeliveryNotice();
        this.updateDeliveryStepComplete();
      },
      blockSlots: window.AbCartConfig.timeslot.blockSlots,
      blockSlotsByDate: window.AbCartConfig.timeslot.blockSlotsByDate,
      weekdayRules: window.AbCartConfig.timeslot.weekdayRules,
      rules: window.AbCartConfig.timeslot.rules,
    });

    this.timeslotPicker.linkDatepicker(this.datePicker);
  }
}



(function initMsgPanel() {
  const getTextarea = () => document.querySelector(".card-message-textarea");
  const getCount = () => document.querySelector("[data-msg-count]");

  const updateCount = (ta) => {
    const count = getCount();
    if (count) count.textContent = String(ta.value.length);
  };

  // Pill click → fill textarea
  document.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-card-message-panel] .ab-cart__pill");
    if (!pill) return;
    e.preventDefault();

    const content = pill.nextElementSibling;
    const ta = getTextarea();
    if (ta && content?.classList.contains("ab-cart__pill-content")) {
      ta.value = content.textContent.trim();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // Character counter
  document.addEventListener("input", (e) => {
    const ta = e.target.closest(".card-message-textarea");
    if (ta) updateCount(ta);
  });

  // Initial render
  const initialTa = getTextarea();
  if (initialTa) updateCount(initialTa);
})();

(function initStickyCheckoutBar() {
  let activeObserver = null;

  const bind = () => {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }

    const cartHost = document.querySelector("ab-cart");
    const slot = cartHost?.querySelector("[data-totals-slot]");
    if (!cartHost || !slot) return;

    activeObserver = new IntersectionObserver(
      (entries) => {
        cartHost.classList.toggle("is-sticky-mode", !entries[0].isIntersecting);
      },
      { threshold: 0 },
    );

    activeObserver.observe(slot);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }

  document.addEventListener("cart:updated", () => requestAnimationFrame(bind));
})();

if (!customElements.get("ab-cart")) customElements.define("ab-cart", AbCart);
if (!customElements.get("ab-addon-picker"))
  customElements.define("ab-addon-picker", AbAddonPicker);
if (!customElements.get("ab-delivery-picker"))
  customElements.define("ab-delivery-picker", AbDeliveryPicker);
