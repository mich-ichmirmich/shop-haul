const signupModalEl = document.getElementById("signup-modal");
const heroEl = document.querySelector(".hero");
const heroGlobeArtEl = document.getElementById("hero-globe-art");
const heroGlobeCanvasEl = document.getElementById("hero-globe-canvas");
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

async function initHeroGlobe() {
  if (!heroEl || !heroGlobeArtEl || !heroGlobeCanvasEl) return;

  try {
    const { default: createGlobe } = await import("https://esm.sh/cobe@0.6.3");

    let phi = 5.92;
    let theta = 0.68;
    let width = 0;
    let globe = null;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let autoSpin = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let spinResumeTimer = null;

    const baseMarkers = [
      { location: [52.52, 13.4], size: 0.09 },
      { location: [59.33, 18.06], size: 0.08 },
      { location: [51.51, -0.13], size: 0.08 },
      { location: [48.85, 2.35], size: 0.08 },
      { location: [40.71, -74.0], size: 0.085 },
      { location: [34.05, -118.24], size: 0.07 },
      { location: [25.2, 55.27], size: 0.07 },
      { location: [19.07, 72.88], size: 0.07 },
      { location: [13.08, 80.27], size: 0.06 },
      { location: [1.35, 103.82], size: 0.08 },
      { location: [35.68, 139.69], size: 0.08 },
      { location: [37.56, 126.98], size: 0.08 },
      { location: [-6.21, 106.85], size: 0.065 },
      { location: [-33.87, 151.21], size: 0.08 },
      { location: [-37.81, 144.96], size: 0.07 }
    ];

    const getWidth = () => heroGlobeArtEl.offsetWidth || 760;

    const destroyGlobe = () => {
      if (globe && typeof globe.destroy === "function") {
        globe.destroy();
      }
      globe = null;
    };

    const buildGlobe = () => {
      destroyGlobe();
      width = getWidth();

      globe = createGlobe(heroGlobeCanvasEl, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: width * 2,
        height: width * 2,
        phi,
        theta,
        dark: 0,
        diffuse: 1.06,
        mapSamples: 30000,
        mapBrightness: 3.4,
        baseColor: [0.964, 0.949, 0.918],
        markerColor: [0.86, 1, 0.29],
        glowColor: [0.98, 0.97, 0.9],
        opacity: 0.54,
        markers: baseMarkers,
        onRender: (state) => {
          const now = performance.now() * 0.001;
          state.width = width * 2;
          state.height = width * 2;
          state.phi = phi;
          state.theta = theta;
          state.markers = baseMarkers.map((marker, index) => {
            const pulse = 0.84 + Math.sin(now * 1.8 + index * 0.85) * 0.16;
            return {
              ...marker,
              size: marker.size * pulse
            };
          });
          state.markerColor = [0.86, 1, 0.29];
          state.glowColor = [0.95, 1, 0.52];

          if (!isDragging && autoSpin) {
            phi += 0.00042;
          }
        }
      });
    };

    const pointerDown = (clientX, clientY) => {
      isDragging = true;
      autoSpin = false;
      if (spinResumeTimer) {
        window.clearTimeout(spinResumeTimer);
        spinResumeTimer = null;
      }
      lastX = clientX;
      lastY = clientY;
      heroGlobeArtEl.style.cursor = "grabbing";
    };

    const pointerMove = (clientX, clientY) => {
      if (!isDragging) return;

      const deltaX = clientX - lastX;
      const deltaY = clientY - lastY;
      lastX = clientX;
      lastY = clientY;

      phi -= deltaX * 0.0082;
      theta = Math.max(0.45, Math.min(0.95, theta + deltaY * 0.0036));
    };

    const pointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      heroGlobeArtEl.style.cursor = "grab";
      spinResumeTimer = window.setTimeout(() => {
        autoSpin = true;
      }, 800);
    };

    buildGlobe();
    heroGlobeArtEl.style.cursor = "grab";

    heroGlobeArtEl.addEventListener("pointerdown", (event) => {
      pointerDown(event.clientX, event.clientY);
      heroGlobeArtEl.setPointerCapture?.(event.pointerId);
    });

    heroGlobeArtEl.addEventListener("pointermove", (event) => {
      pointerMove(event.clientX, event.clientY);
    });

    window.addEventListener("pointerup", () => {
      pointerUp();
    });

    window.addEventListener("resize", () => {
      buildGlobe();
    });
  } catch (error) {
    console.warn("Hero globe failed to load", error);
    if (heroGlobeArtEl) {
      heroGlobeArtEl.hidden = true;
    }
  }
}

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
  initHeroGlobe();
  syncTopbarState();
  load();
}
