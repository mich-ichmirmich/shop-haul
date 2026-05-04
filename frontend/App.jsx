import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { feature } from "topojson-client";
import countriesTopology from "world-atlas/countries-110m.json";

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

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

async function preloadImageWithFallback(primaryUrl, fallbackUrl, timeoutMs = 7000) {
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

const landFeatures = feature(countriesTopology, countriesTopology.objects.countries).features.filter(
  (country) => country.id !== "010"
);
const salesHotspots = [
  { lat: 40.7128, lng: -74.006 },
  { lat: 34.0522, lng: -118.2437 },
  { lat: 41.8781, lng: -87.6298 },
  { lat: 29.7604, lng: -95.3698 },
  { lat: 25.7617, lng: -80.1918 },
  { lat: 19.4326, lng: -99.1332 },
  { lat: 4.711, lng: -74.0721 },
  { lat: -12.0464, lng: -77.0428 },
  { lat: -33.4489, lng: -70.6693 },
  { lat: 51.5074, lng: -0.1278 },
  { lat: 48.8566, lng: 2.3522 },
  { lat: 52.52, lng: 13.405 },
  { lat: 59.3293, lng: 18.0686 },
  { lat: 41.9028, lng: 12.4964 },
  { lat: 40.4168, lng: -3.7038 },
  { lat: 25.2048, lng: 55.2708 },
  { lat: 19.076, lng: 72.8777 },
  { lat: 28.6139, lng: 77.209 },
  { lat: 1.3521, lng: 103.8198 },
  { lat: 13.7563, lng: 100.5018 },
  { lat: 35.6762, lng: 139.6503 },
  { lat: 37.5665, lng: 126.978 },
  { lat: -33.8688, lng: 151.2093 },
  { lat: -37.8136, lng: 144.9631 },
  { lat: -23.5505, lng: -46.6333 },
  { lat: -34.6037, lng: -58.3816 },
  { lat: 43.6532, lng: -79.3832 },
  { lat: 49.2827, lng: -123.1207 },
  { lat: 30.0444, lng: 31.2357 },
  { lat: 6.5244, lng: 3.3792 },
  { lat: -26.2041, lng: 28.0473 },
];

const visibleHemisphereHotspots = salesHotspots.filter((spot) => spot.lng <= -20 || spot.lng >= 120);

function shuffleList(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function sampleSalesMarkers(count) {
  const front = shuffleList(visibleHemisphereHotspots).slice(0, Math.max(4, Math.ceil(count * 0.7)));
  const global = shuffleList(salesHotspots)
    .filter((spot) => !front.includes(spot))
    .slice(0, Math.max(0, count - front.length));

  return [...front, ...global].map((spot, index) => ({
    ...spot,
    size: 0.28 + Math.random() * 0.28,
    altitude: 0.016 + Math.random() * 0.024,
    color: index % 4 === 0 ? "#f8ffbe" : index % 2 === 0 ? "#efff7e" : "#dbff49",
  }));
}

function HeroGlobe() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const hero = container?.closest(".hero");
    if (!container || !hero) return undefined;
    let scene;
    let camera;
    let renderer;
    let ambientLight;
    let keyLight;
    let rimLight;
    let globe;
    let globeGroup;
    let resizeObserver;
    let rafId = 0;
    let salesInterval = 0;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragRotationX = 0;
    let dragRotationY = 0;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const handleMove = (event) => {
      if (isDragging) return;
      const rect = hero.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      targetTiltY = px * 0.2;
      targetTiltX = py * -0.14;
    };

    const resetMove = () => {
      if (isDragging) return;
      targetTiltX = 0;
      targetTiltY = 0;
    };

    const handlePointerDown = (event) => {
      if (!globe) return;
      isDragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragRotationX = globe.rotation.x;
      dragRotationY = globe.rotation.y;
      targetTiltX = 0;
      targetTiltY = 0;
      container.setPointerCapture?.(event.pointerId);
      container.classList.add("is-dragging");
    };

    const handlePointerDrag = (event) => {
      if (!isDragging || !globe) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      globe.rotation.y = dragRotationY + deltaX * 0.0065;
      globe.rotation.x = clamp(dragRotationX + deltaY * 0.0036, 0.08, 0.72);
    };

    const endDrag = (event) => {
      if (!isDragging) return;
      isDragging = false;
      container.releasePointerCapture?.(event.pointerId);
      container.classList.remove("is-dragging");
    };

    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(24, 1, 0.1, 1000);
      camera.position.set(0, 0, 290);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      ambientLight = new THREE.AmbientLight(0xffffff, 1.18);
      keyLight = new THREE.DirectionalLight(0xfff7ea, 1.35);
      keyLight.position.set(120, 80, 210);
      rimLight = new THREE.DirectionalLight(0xdbff49, 0.42);
      rimLight.position.set(-120, -30, 140);
      scene.add(ambientLight, keyLight, rimLight);

      const initialMarkers = sampleSalesMarkers(10);

      globe = new ThreeGlobe({ waitForGlobeReady: false, animateIn: false })
        .polygonsData(landFeatures)
        .polygonAltitude(0.003)
        .polygonCapColor(() => "rgba(38,38,38,0.2)")
        .polygonSideColor(() => "rgba(38,38,38,0.03)")
        .polygonStrokeColor(() => "rgba(38,38,38,0.07)")
        .pointsData(initialMarkers)
        .pointLat("lat")
        .pointLng("lng")
        .pointAltitude("altitude")
        .pointRadius("size")
        .pointColor("color")
        .ringsData(initialMarkers)
        .ringLat("lat")
        .ringLng("lng")
        .ringColor((d) => () =>
          d.color === "#f8ffbe"
            ? "rgba(248,255,190,0.92)"
            : d.color === "#efff7e"
              ? "rgba(239,255,126,0.88)"
              : "rgba(219,255,73,0.9)"
        )
        .ringMaxRadius(5.1)
        .ringPropagationSpeed(1.65)
        .ringRepeatPeriod(380)
        .showAtmosphere(true)
        .atmosphereColor("#dbff49")
        .atmosphereAltitude(0.12);

      const material = globe.globeMaterial();
      material.color = new THREE.Color("#f8f4ec");
      material.emissive = new THREE.Color("#f3ead7");
      material.emissiveIntensity = 0.1;
      material.shininess = 0.7;
      material.transparent = true;
      material.opacity = 0.96;

      globeGroup = new THREE.Group();
      globeGroup.add(globe);
      globeGroup.position.set(28, -4, 0);
      globeGroup.scale.setScalar(0.46);
      globe.rotation.set(0.34, -0.7, -0.04);
      scene.add(globeGroup);

      const refreshSales = () => {
        const markers = sampleSalesMarkers(14 + Math.floor(Math.random() * 7));
        globe.pointsData(markers);
        globe.ringsData(markers.filter(() => Math.random() > 0.04));
      };

      const resize = () => {
        const rect = container.getBoundingClientRect();
        const width = Math.max(rect.width, 1);
        const height = Math.max(rect.height, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const animate = () => {
        if (!isDragging) {
          globe.rotation.y += 0.0019;
          globeGroup.rotation.x += (targetTiltX - globeGroup.rotation.x) * 0.06;
          globeGroup.rotation.y += (targetTiltY - globeGroup.rotation.y) * 0.06;
        }
        renderer.render(scene, camera);
        rafId = window.requestAnimationFrame(animate);
      };

      resize();
      animate();
      salesInterval = window.setInterval(refreshSales, 240);

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      hero.addEventListener("pointermove", handleMove);
      hero.addEventListener("pointerleave", resetMove);
      container.addEventListener("pointerdown", handlePointerDown);
      window.addEventListener("pointermove", handlePointerDrag);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    } catch (error) {
      console.error("Hero globe failed to initialize", error);
      container.setAttribute("data-globe-failed", "true");
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(salesInterval);
      resizeObserver?.disconnect();
      hero.removeEventListener("pointermove", handleMove);
      hero.removeEventListener("pointerleave", resetMove);
      container.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      container.classList.remove("is-dragging");
      if (scene && globeGroup) scene.remove(globeGroup);
      if (scene && ambientLight) scene.remove(ambientLight);
      if (scene && keyLight) scene.remove(keyLight);
      if (scene && rimLight) scene.remove(rimLight);
      renderer?.dispose?.();
      container.innerHTML = "";
    };
  }, []);

  return (
    <div className="hero-globe" aria-hidden="true">
      <div className="hero-globe-haze" />
      <div ref={containerRef} className="hero-globe-canvas" />
    </div>
  );
}

function TagMultiSelect({ options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleTag = (tag) => {
    onChange(values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag]);
  };

  const label =
    values.length === 0 ? "All tags" : values.length === 1 ? values[0] : `${values.length} tags selected`;

  return (
    <div ref={rootRef} className="relative min-w-[170px] flex-1 basis-[170px]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-[52px] w-full items-center justify-between rounded-[1.1rem] border border-black/8 bg-white px-4 font-mono text-[0.82rem] shadow-[0_1px_0_rgba(0,0,0,0.04)] outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <span className="ml-3 text-black/45">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.55rem)] z-30 max-h-72 overflow-auto rounded-[1.1rem] border border-black/8 bg-white p-2 shadow-[0_18px_50px_rgba(17,17,17,0.12)]">
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <span className="font-mono text-[0.72rem] text-black/55">Tags</span>
            {values.length ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-mono text-[0.72rem] font-semibold text-black/65 underline underline-offset-3"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="space-y-1" role="listbox" aria-multiselectable="true">
            {options.map((tag) => {
              const checked = values.includes(tag);
              return (
                <label
                  key={tag}
                  className="flex cursor-pointer items-center gap-3 rounded-[0.95rem] px-3 py-2 transition hover:bg-black/[0.03]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTag(tag)}
                    className="h-4 w-4 rounded border-black/20 accent-black"
                  />
                  <span className="font-mono text-[0.78rem] text-black/82">{tag}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CategoryMultiSelect({ options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleCategory = (category) => {
    onChange(values.includes(category) ? values.filter((value) => value !== category) : [...values, category]);
  };

  const label =
    values.length === 0 ? "All categories" : values.length === 1 ? values[0] : `${values.length} categories selected`;

  return (
    <div ref={rootRef} className="relative min-w-[170px] flex-1 basis-[170px]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-[52px] w-full items-center justify-between rounded-[1.1rem] border border-black/8 bg-white px-4 font-mono text-[0.82rem] shadow-[0_1px_0_rgba(0,0,0,0.04)] outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <span className="ml-3 text-black/45">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.55rem)] z-30 max-h-72 overflow-auto rounded-[1.1rem] border border-black/8 bg-white p-2 shadow-[0_18px_50px_rgba(17,17,17,0.12)]">
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <span className="font-mono text-[0.72rem] text-black/55">Categories</span>
            {values.length ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-mono text-[0.72rem] font-semibold text-black/65 underline underline-offset-3"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="space-y-1" role="listbox" aria-multiselectable="true">
            {options.map((category) => {
              const checked = values.includes(category);
              return (
                <label
                  key={category}
                  className="flex cursor-pointer items-center gap-3 rounded-[0.95rem] px-3 py-2 transition hover:bg-black/[0.03]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCategory(category)}
                    className="h-4 w-4 rounded border-black/20 accent-black"
                  />
                  <span className="font-mono text-[0.78rem] text-black/82">{category}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShopCard({ shop, index, onCopy }) {
  const [src, setSrc] = useState(() => screenshotOfUrlFor(shop.url));
  const [step, setStep] = useState(0);

  const handleError = () => {
    if (step === 0) {
      setStep(1);
      setSrc(thumUrlFor(shop.url));
    }
  };

  return (
    <article
      className="vault-card-enter group flex h-full flex-col overflow-hidden rounded-[18px] border border-black/8 bg-card shadow-[0_14px_34px_rgba(17,17,17,0.06)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_22px_50px_rgba(17,17,17,0.12)]"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <a className="block overflow-hidden" href={shop.url} target="_blank" rel="noreferrer">
        <img
          className="aspect-[3308/1900] w-full object-cover object-top transition duration-500 group-hover:scale-[1.025]"
          src={src}
          alt={`${shop.title} screenshot`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleError}
        />
      </a>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3">
        <div className="space-y-2">
          <h2 className="truncate text-[1.25rem] font-[650] tracking-[-0.035em] text-foreground">{shop.title}</h2>
          <p className="min-h-[2.6em] text-[0.96rem] leading-[1.35] text-black/62">{shop.notes || ""}</p>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5 border-b border-black/8 pb-3">
            {shop.category ? (
              <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-mono text-[0.67rem] text-black/72">
                {shop.category}
              </span>
            ) : null}
            {shop.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-black/[0.06] px-2.5 py-1 font-mono text-[0.67rem] text-black/72">
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={shop.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full bg-black px-4 font-mono text-[0.76rem] font-semibold text-white transition hover:bg-black/85"
            >
              Visit site
            </a>
            <button
              type="button"
              onClick={() => onCopy(shop)}
              className="inline-flex h-11 items-center justify-center rounded-full border border-black/10 bg-white px-4 font-mono text-[0.76rem] font-semibold text-black transition hover:bg-black/[0.03]"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [shops, setShops] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [signupOpen, setSignupOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    categories: [],
    tags: [],
    summary: "",
    sort: "recent"
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/shops", { credentials: "include" });
        if (response.status === 401) {
          window.location.assign("/auth/login");
          return;
        }
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.details || data.error || "Unknown API error");
        }

        if (cancelled) return;
        setShops(data.shops || []);
        setCategories(data.categories || []);
        setTags(data.tags || []);
        await Promise.all(
          (data.shops || [])
            .slice(0, PAGE_SIZE)
            .map((shop) => preloadImageWithFallback(screenshotOfUrlFor(shop.url), thumUrlFor(shop.url)))
        );
        if (!cancelled) setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filters.categories, filters.tags, filters.summary, filters.sort]);

  useEffect(() => {
    if (!signupOpen) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") setSignupOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [signupOpen]);

  const filteredShops = useMemo(() => {
    let items = shops;

    if (filters.categories.length > 0) {
      const selectedCategories = filters.categories.map(normalizeText);
      items = items.filter((shop) => selectedCategories.includes(normalizeText(shop.category)));
    }

    if (filters.tags.length > 0) {
      const selectedTags = filters.tags.map(normalizeText);
      items = items.filter((shop) => {
        const shopTags = shop.tags.map(normalizeText);
        return selectedTags.every((tag) => shopTags.includes(tag));
      });
    }

    const summaryQuery = normalizeText(filters.summary);
    if (summaryQuery) {
      items = items.filter((shop) => {
        const haystack = [
          shop.title,
          shop.url,
          shop.category,
          shop.notes,
          ...(shop.tags || []),
        ]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(summaryQuery);
      });
    }

    const sorted = [...items];
    if (filters.sort === "az") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (filters.sort === "za") sorted.sort((a, b) => b.title.localeCompare(a.title));
    else if (filters.sort === "oldest") sorted.sort((a, b) => new Date(a.editedAt) - new Date(b.editedAt));
    else sorted.sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));

    return sorted;
  }, [filters, shops]);

  const visibleCount = Math.min(filteredShops.length, page * PAGE_SIZE);
  const visibleShops = filteredShops.slice(0, visibleCount);
  const hasMore = visibleCount < filteredShops.length;
  const activeFilterCount =
    filters.categories.length + filters.tags.length + Number(Boolean(filters.summary.trim()));

  const statusText = error
    ? `Could not load data: ${error}`
    : filteredShops.length
      ? `Showing ${visibleCount} of ${filteredShops.length} shops`
      : loading
        ? "Loading shops..."
        : "No shops match your current filters.";

  const handleCopy = async (shop) => {
    try {
      await navigator.clipboard.writeText(shop.url);
      setCopiedUrl(shop.url);
      window.setTimeout(() => {
        setCopiedUrl((value) => (value === shop.url ? "" : value));
      }, 1200);
    } catch {
      setCopiedUrl("__failed__");
      window.setTimeout(() => setCopiedUrl(""), 1200);
    }
  };

  const handleLoadMore = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    window.setTimeout(() => {
      setPage((current) => current + 1);
      setLoadingMore(false);
    }, 220);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-black text-white">
        <div className="mx-auto flex h-12 max-w-[1560px] items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setSignupOpen(true)}
            className="font-mono text-[0.79rem] font-semibold text-white underline underline-offset-4"
          >
            Join free
          </button>
        </div>
      </header>

      <main className="px-0 pb-10 pt-0">
        <div className="vault-shell mx-auto w-full overflow-hidden border border-black/6 bg-[#ffffff] sm:rounded-[1.75rem]">
          <section className="hero">
            <HeroGlobe />
            <div className="hero-inner">
              <div className="hero-logo">
                <img src="/assets/shop-haul-logo-white.svg" alt="Shop Haul logo" className="h-full w-full object-contain" />
              </div>
              <h1>
                <span className="hero-line">E-Commerce Meets Design.</span>
                <br />
                <span className="hero-line">Stay Ahead of the Curve!</span>
              </h1>
              <p className="subtitle">
                Discover the most innovative Shopify stores curated from the Shop Haul archive.
              </p>
            </div>
          </section>

          <section className="bg-[#ffffff] px-4 py-5 sm:px-5 lg:px-6">
            <div className="mx-auto max-w-[1760px]">
              <div className="flex flex-wrap items-center gap-3 rounded-[1.65rem] bg-black/[0.03] p-3">
                <CategoryMultiSelect
                  options={categories}
                  values={filters.categories}
                  onChange={(nextCategories) => setFilters((state) => ({ ...state, categories: nextCategories }))}
                />

                <TagMultiSelect
                  options={tags}
                  values={filters.tags}
                  onChange={(nextTags) => setFilters((state) => ({ ...state, tags: nextTags }))}
                />

                <label className="min-w-[320px] flex-[1.8] basis-[420px]">
                  <input
                    type="search"
                    value={filters.summary}
                    onChange={(event) => setFilters((state) => ({ ...state, summary: event.target.value }))}
                    placeholder="Search description / notes / summary ..."
                    className="h-[52px] w-full rounded-[1.1rem] border border-black/8 bg-white px-4 font-mono text-[0.82rem] outline-none placeholder:text-black/42"
                  />
                </label>

                <label className="min-w-[170px] flex-1 basis-[170px]">
                  <select
                    value={filters.sort}
                    onChange={(event) => setFilters((state) => ({ ...state, sort: event.target.value }))}
                    className="h-[52px] w-full appearance-none rounded-[1.1rem] border border-black/8 bg-white px-4 font-mono text-[0.82rem] shadow-[0_1px_0_rgba(0,0,0,0.04)] outline-none"
                  >
                    <option value="recent">Recently edited</option>
                    <option value="oldest">Oldest edited</option>
                    <option value="az">Title A-Z</option>
                    <option value="za">Title Z-A</option>
                  </select>
                </label>

                <div className="ml-auto flex items-center gap-3 max-sm:w-full max-sm:justify-between">
                  <span className="vault-dot-pulse inline-flex h-12 min-w-12 items-center justify-center rounded-full bg-primary px-4 font-mono text-[0.82rem] font-semibold text-black">
                    {activeFilterCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilters({ categories: [], tags: [], summary: "", sort: "recent" })}
                    className="inline-flex h-[52px] items-center justify-center rounded-full border border-black/8 bg-white px-6 font-mono text-[0.82rem] font-semibold text-black transition hover:bg-black/[0.03]"
                  >
                    Reset filters ↺
                  </button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[0.92rem] font-semibold tracking-[-0.02em] text-black/74">{statusText}</p>
                  {loading && !error ? (
                    <div className="mt-2 inline-flex items-center gap-2 font-mono text-[0.76rem] text-black/56">
                      <span>Loading shops</span>
                      <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-black/18 border-t-black/60 animate-spin" />
                    </div>
                  ) : null}
                </div>
                <p className="text-right text-[0.84rem] text-black/56">
                  Screenshots by{" "}
                  <a
                    href="https://www.onemillionscreenshots.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-black underline underline-offset-4"
                  >
                    One Million Screenshots
                  </a>
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {visibleShops.map((shop, index) => (
                  <ShopCard key={shop.id} shop={shop} index={index} onCopy={handleCopy} />
                ))}
              </div>

              {hasMore ? (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="inline-flex h-12 items-center justify-center rounded-full border border-black/10 bg-white px-6 font-mono text-[0.82rem] font-semibold text-black transition hover:bg-black/[0.03] disabled:cursor-wait disabled:opacity-70"
                  >
                    {loadingMore ? (
                      <span className="inline-flex items-center gap-2">
                        <span>Loading more</span>
                        <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-black/18 border-t-black/60 animate-spin" />
                      </span>
                    ) : (
                      "Load more"
                    )}
                  </button>
                </div>
              ) : null}

              {copiedUrl ? (
                <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black px-4 py-2 font-mono text-[0.76rem] text-white shadow-lg">
                  {copiedUrl === "__failed__" ? "Copy failed" : "Link copied"}
                </div>
              ) : null}
            </div>
          </section>

          <footer className="bg-black px-4 py-8 text-white sm:px-5 lg:px-6">
            <div className="mx-auto flex max-w-[1760px] flex-col justify-between gap-10 md:flex-row md:items-start">
              <div className="max-w-[620px]">
                <a href="/" className="inline-flex overflow-visible">
                  <img
                    src="/assets/shop-haul-logo-white-quer.svg"
                    alt="Shop Haul"
                    className="-ml-[14px] h-[72px] w-auto md:-ml-[18px] md:h-[82px]"
                  />
                </a>
                <p className="-mt-[1px] max-w-[560px] text-[1rem] leading-[1.55] tracking-[-0.01em] text-white/82">
                  Passionate about design, obsessed with commerce
                  <br />
                  and always exploring standout stores.
                </p>
                <button
                  type="button"
                  onClick={() => setSignupOpen(true)}
                  className="mt-7 inline-flex h-13 items-center justify-center self-start rounded-full bg-primary px-7 font-mono text-[0.95rem] font-semibold text-black transition hover:brightness-95"
                >
                  Join free
                </button>
              </div>

              <nav className="md:min-w-[300px] md:pt-3">
                <p className="text-[1.45rem] font-[550] tracking-[-0.03em] text-white">Projects</p>
                <ul className="mt-5 space-y-1.5">
                  <li>
                    <a
                      href="https://outfitcheck.shop-haul.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[1rem] leading-[1.45] text-white/84 transition hover:text-white"
                    >
                      Shop Haul Outfit Check
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.shop-haul.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[1rem] leading-[1.45] text-white/84 transition hover:text-white"
                    >
                      Shop Haul Newsletter
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.shop-haul.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[1rem] leading-[1.45] text-white/84 transition hover:text-white"
                    >
                      Shop Haul Merchandise
                    </a>
                  </li>
                </ul>
              </nav>
            </div>
          </footer>
        </div>
      </main>

      {signupOpen ? (
        <div className="fixed inset-0 z-[1200] grid place-items-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/72"
            aria-label="Close signup"
            onClick={() => setSignupOpen(false)}
          />
          <div className="relative z-10 w-[min(92vw,920px)] rounded-[20px] border border-white/10 bg-[#0f0f0f] p-4 pt-14 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <button
              type="button"
              onClick={() => setSignupOpen(false)}
              className="absolute right-3 top-3 inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/4 px-4 font-mono text-[0.76rem] text-white"
            >
              Close
            </button>
            <iframe
              src="https://embeds.beehiiv.com/8917ce1a-75db-4db1-b1f8-6e623ee7d352"
              data-test-id="beehiiv-embed"
              width="100%"
              height="320"
              frameBorder="0"
              scrolling="no"
              style={{ borderRadius: "4px", border: "2px solid #e5e7eb", margin: 0, backgroundColor: "transparent" }}
              title="Join Shop Haul"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
