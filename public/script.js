const signupModalEl = document.getElementById("signup-modal");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const statusSpinnerEl = document.getElementById("status-spinner");
const topbarEl = document.querySelector(".topbar");
const galleryEl = document.getElementById("gallery");
const cardTemplate = document.getElementById("card-template");
const categoryFilterEl = document.getElementById("category-filter");
const tagFilterEl = document.getElementById("tag-filter");
const summaryFilterEl = document.getElementById("summary-filter");
const sortSelectEl = document.getElementById("sort-select");
const resetFiltersEl = document.getElementById("reset-filters");
const activeFilterCountEl = document.getElementById("active-filter-count");
const loadMoreBtnEl = document.getElementById("load-more");
const scrollSentinelEl = document.getElementById("scroll-sentinel");
const openSignupEls = Array.from(document.querySelectorAll("[data-open-signup]"));
const closeSignupEls = Array.from(document.querySelectorAll("[data-close-signup]"));

const PAGE_SIZE = 12;
const MACBOOK_VIEWPORT_WIDTH = 3308;
const MACBOOK_VIEWPORT_HEIGHT = 1900;
const thumUrlFor = (url) =>
  `https://image.thum.io/get/width/${MACBOOK_VIEWPORT_WIDTH}/crop/${MACBOOK_VIEWPORT_HEIGHT}/noanimate/${encodeURIComponent(url)}`;
const screenshotOfUrlFor = (url) => {
  try {
    const host = new URL(url).hostname;
    return host ? `https://screenshotof.com/${host}` : thumUrlFor(url);
  } catch {
    return thumUrlFor(url);
  }
};

let allShops = [];
let filteredShops = [];
let activeCategory = "all";
let activeTag = "all";
let activeSummary = "";
let activeSort = "recent";
let currentPage = 1;
let isAutoLoading = false;
let sentinelObserver = null;

function syncTopbarState() {
  if (!topbarEl) return;
  const isScrolled = window.scrollY > 28;
  topbarEl.classList.toggle("scrolled", isScrolled);
}

function preloadImageWithFallback(primaryUrl, fallbackUrl, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);

    img.onload = () => {
      window.clearTimeout(timer);
      finish();
    };

    img.onerror = () => {
      if (fallbackUrl && img.src !== fallbackUrl) {
        img.src = fallbackUrl;
        return;
      }
      window.clearTimeout(timer);
      finish();
    };

    img.src = primaryUrl;
  });
}

async function preloadInitialBatchScreenshots(shops) {
  const firstBatch = shops.slice(0, PAGE_SIZE);
  if (!firstBatch.length) return;

  // Preload first visible cards so users don't see empty media slots.
  await Promise.all(
    firstBatch.map((shop) => preloadImageWithFallback(screenshotOfUrlFor(shop.url), thumUrlFor(shop.url)))
  );
}

function setStatus(message, loading = false) {
  if (statusTextEl) {
    statusTextEl.textContent = message;
  } else if (statusEl) {
    statusEl.textContent = message;
  }

  if (statusSpinnerEl) {
    statusSpinnerEl.hidden = !loading;
  }
}

function openSignupModal() {
  if (!signupModalEl) return;
  signupModalEl.hidden = false;
  signupModalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeSignupModal() {
  if (!signupModalEl) return;
  signupModalEl.hidden = true;
  signupModalEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function setSelectOptions(selectEl, items, allLabel) {
  if (!selectEl) return;

  const previous = selectEl.value;
  selectEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = allLabel;
  selectEl.appendChild(allOption);

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    selectEl.appendChild(option);
  });

  selectEl.value = items.includes(previous) ? previous : "all";
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function sortShops(shops) {
  const list = [...shops];

  if (activeSort === "az") {
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }

  if (activeSort === "za") {
    return list.sort((a, b) => b.title.localeCompare(a.title));
  }

  if (activeSort === "oldest") {
    return list.sort((a, b) => new Date(a.editedAt) - new Date(b.editedAt));
  }

  return list.sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
}

function computeFilteredShops() {
  const summaryQuery = normalizeText(activeSummary);

  let items = allShops;

  if (activeCategory !== "all") {
    items = items.filter((shop) => normalizeText(shop.category) === normalizeText(activeCategory));
  }

  if (activeTag !== "all") {
    items = items.filter((shop) => shop.tags.map(normalizeText).includes(normalizeText(activeTag)));
  }

  if (summaryQuery) {
    items = items.filter((shop) => normalizeText(shop.notes).includes(summaryQuery));
  }

  filteredShops = sortShops(items);
}

function visibleCount() {
  return Math.min(filteredShops.length, currentPage * PAGE_SIZE);
}

function visibleShops() {
  return filteredShops.slice(0, visibleCount());
}

function hasMoreShops() {
  return visibleCount() < filteredShops.length;
}

function buildCard(shop) {
  if (!cardTemplate) return document.createDocumentFragment();

  const node = cardTemplate.content.cloneNode(true);
  const link = node.querySelector(".image-link");
  const image = node.querySelector(".shot");
  const name = node.querySelector(".shop-name");
  const notes = node.querySelector(".notes");
  const chips = node.querySelector(".chip-row");
  const visit = node.querySelector(".visit");
  const copyLink = node.querySelector(".copy-link");

  link.href = shop.url;
  image.src = screenshotOfUrlFor(shop.url);
  image.alt = `${shop.title} screenshot`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.dataset.fallbackStep = "0";
  image.addEventListener("error", () => {
    if (image.dataset.fallbackStep === "0") {
      image.dataset.fallbackStep = "1";
      image.src = thumUrlFor(shop.url);
    }
  });

  name.textContent = shop.title;
  name.title = shop.title;
  notes.textContent = shop.notes || "";

  chips.innerHTML = "";

  if (shop.category) {
    const categoryChip = document.createElement("span");
    categoryChip.className = "chip";
    categoryChip.textContent = shop.category;
    chips.appendChild(categoryChip);
  }

  shop.tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = tag;
    chips.appendChild(chip);
  });

  visit.href = shop.url;
  if (copyLink) {
    copyLink.addEventListener("click", async () => {
      const original = copyLink.textContent;
      try {
        await navigator.clipboard.writeText(shop.url);
        copyLink.textContent = "Copied";
      } catch {
        copyLink.textContent = "Failed";
      }

      window.setTimeout(() => {
        copyLink.textContent = original;
      }, 1200);
    });
  }

  return node;
}

function renderStatus() {
  if (!statusEl) return;
  if (!filteredShops.length) {
    setStatus("No shops match your current filters.", false);
    return;
  }

  setStatus(
    `Showing ${visibleCount()} of ${filteredShops.length} shop${filteredShops.length === 1 ? "" : "s"}`,
    false
  );
}

function renderLoadMore() {
  if (!loadMoreBtnEl || !scrollSentinelEl) return;
  const hasMore = hasMoreShops();
  loadMoreBtnEl.hidden = !hasMore;
  scrollSentinelEl.hidden = !hasMore;
}

function activeFiltersCount() {
  let count = 0;
  if (activeCategory !== "all") count += 1;
  if (activeTag !== "all") count += 1;
  if (activeSummary.trim()) count += 1;
  return count;
}

function renderActiveFilterCount() {
  if (!activeFilterCountEl) return;
  activeFilterCountEl.textContent = String(activeFiltersCount());
}

function renderGallery() {
  if (!galleryEl) return;
  const shops = visibleShops();
  galleryEl.innerHTML = "";

  shops.forEach((shop) => galleryEl.appendChild(buildCard(shop)));

  renderStatus();
  renderLoadMore();
  renderActiveFilterCount();
  window.requestAnimationFrame(() => {
    maybeAutoLoad();
    ensureViewportFilled();
  });
}

function refreshAndRender(resetPage = false) {
  if (resetPage) {
    currentPage = 1;
  }

  computeFilteredShops();
  renderGallery();
}

function resetFilters() {
  activeCategory = "all";
  activeTag = "all";
  activeSummary = "";

  if (categoryFilterEl) categoryFilterEl.value = "all";
  if (tagFilterEl) tagFilterEl.value = "all";
  if (summaryFilterEl) summaryFilterEl.value = "";

  refreshAndRender(true);
}

function loadMore() {
  if (!hasMoreShops()) {
    return;
  }

  currentPage += 1;
  renderGallery();
}

if (loadMoreBtnEl) {
  loadMoreBtnEl.addEventListener("click", loadMore);
}

function maybeAutoLoad() {
  if (isAutoLoading) return;
  if (!hasMoreShops()) return;

  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 260;
  if (!nearBottom) return;

  isAutoLoading = true;
  loadMore();
  window.requestAnimationFrame(() => {
    isAutoLoading = false;
  });
}

window.addEventListener("scroll", maybeAutoLoad, { passive: true });
window.addEventListener("scroll", syncTopbarState, { passive: true });
window.addEventListener("resize", maybeAutoLoad);

function ensureViewportFilled() {
  if (!hasMoreShops()) return;
  const shortPage = document.documentElement.scrollHeight <= window.innerHeight + 120;
  if (!shortPage) return;
  loadMore();
}

if ("IntersectionObserver" in window && scrollSentinelEl) {
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          maybeAutoLoad();
        }
      });
    },
    { rootMargin: "320px 0px 320px 0px" }
  );
  sentinelObserver.observe(scrollSentinelEl);
} else if (scrollSentinelEl) {
  scrollSentinelEl.addEventListener("focusin", maybeAutoLoad);
}

if (categoryFilterEl) {
  categoryFilterEl.addEventListener("change", (event) => {
    activeCategory = event.target.value;
    refreshAndRender(true);
  });
}

if (tagFilterEl) {
  tagFilterEl.addEventListener("change", (event) => {
    activeTag = event.target.value;
    refreshAndRender(true);
  });
}

if (summaryFilterEl) {
  summaryFilterEl.addEventListener("input", (event) => {
    activeSummary = event.target.value || "";
    refreshAndRender(true);
  });
}

if (sortSelectEl) {
  sortSelectEl.addEventListener("change", (event) => {
    activeSort = event.target.value;
    refreshAndRender(true);
  });
}

if (resetFiltersEl) {
  resetFiltersEl.addEventListener("click", resetFilters);
}

openSignupEls.forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    openSignupModal();
  });
});

closeSignupEls.forEach((el) => {
  el.addEventListener("click", closeSignupModal);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSignupModal();
  }
});

async function load() {
  try {
    setStatus("Loading shops...", true);
    const response = await fetch("/api/shops");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.details || data.error || "Unknown API error");
    }

    allShops = data.shops || [];
    setSelectOptions(categoryFilterEl, data.categories || [], "All categories");
    setSelectOptions(tagFilterEl, data.tags || [], "All tags");
    await preloadInitialBatchScreenshots(allShops);
    refreshAndRender(true);
    return true;
  } catch (error) {
    setStatus(`Could not load data: ${error instanceof Error ? error.message : String(error)}`, false);
    if (loadMoreBtnEl) loadMoreBtnEl.hidden = true;
    if (scrollSentinelEl) scrollSentinelEl.hidden = true;
    return false;
  }
}

if (!statusEl || !galleryEl || !cardTemplate) {
  console.error("Gallery init failed: missing required DOM elements.");
} else {
  syncTopbarState();
  load();
}
