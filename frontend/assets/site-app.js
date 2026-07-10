"use strict";

const API_BASE = "/api/v1";
const LIST_FETCH_LIMIT = 100;

const categoryIcons = {
  "printers-and-scanners": "printer",
  outlook: "mail",
  "password-reset": "key",
  multifactor: "shield",
  terminals: "server",
  users: "users",
  forticlient: "shield",
  "wifi-and-internet": "wifi",
  "mts-link": "video",
  "computers-and-laptops": "laptop",
  peripherals: "mouse",
  other: "more",
};

const state = {
  categories: [],
  selectedCategory: null,
  query: "",
  totalItems: 0,
  listRequest: null,
  detailCache: new Map(),
  toastTimer: null,
};

const elements = {
  sidebar: document.querySelector("#sidebar"),
  mobileMenuButton: document.querySelector("#mobile-menu-btn"),
  closeSidebarButton: document.querySelector("#close-sidebar-btn"),
  mobileOverlay: document.querySelector("#mobile-overlay"),
  nav: document.querySelector("#category-nav"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  clearSearchButton: document.querySelector("#clear-search-btn"),
  contentShell: document.querySelector(".content-shell"),
  title: document.querySelector("#current-category-title"),
  resultCount: document.querySelector("#results-count"),
  list: document.querySelector("#instructions-container"),
  pagination: document.querySelector("#pagination"),
  emptyState: document.querySelector("#empty-state"),
  resetFiltersButton: document.querySelector("#reset-filters-btn"),
  imageViewer: document.querySelector("#image-viewer"),
  imageViewerBackdrop: document.querySelector("#image-viewer-backdrop"),
  imageViewerClose: document.querySelector("#image-viewer-close"),
  imageViewerImage: document.querySelector("#image-viewer-img"),
  imageViewerCaption: document.querySelector("#image-viewer-caption"),
  toast: document.querySelector("#toast"),
};

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function pluralizeInstructions(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} инструкция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} инструкции`;
  return `${count} инструкций`;
}

function debounce(callback, wait) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), wait);
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    ...options,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(body?.detail || `Ошибка сервера (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3600);
}

function setSidebarOpen(open) {
  elements.sidebar.classList.toggle("is-open", open);
  elements.mobileOverlay.hidden = !open;
  document.body.classList.toggle("is-sidebar-open", open);
}

function selectedCategoryName() {
  if (!state.selectedCategory) return "Все инструкции";
  return state.categories.find((item) => item.slug === state.selectedCategory)?.name || "Раздел";
}

function setListLoading() {
  elements.emptyState.hidden = true;
  elements.pagination.hidden = true;
  elements.list.setAttribute("aria-busy", "true");
  elements.list.replaceChildren(
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
  );
}

function renderNav() {
  const total = state.categories.reduce((sum, item) => sum + item.instruction_count, 0);
  const fragment = document.createDocumentFragment();

  const allButton = createCategoryButton({
    slug: null,
    name: "Все инструкции",
    instruction_count: total,
  });
  fragment.append(allButton);

  state.categories.forEach((category) => {
    fragment.append(createCategoryButton(category));
  });

  elements.nav.replaceChildren(fragment);
}

function createCategoryButton(category) {
  const button = createElement("button", "category-link");
  button.type = "button";
  button.dataset.category = category.slug || "";
  button.setAttribute("aria-pressed", String(state.selectedCategory === category.slug));
  if (state.selectedCategory === category.slug) button.classList.add("is-active");

  const iconName = category.slug ? categoryIcons[category.slug] || "more" : "all";
  button.append(
    createIcon(iconName),
    createElement("span", "category-name", category.name),
    createElement("span", "category-count", category.instruction_count),
  );
  button.addEventListener("click", () => {
    state.selectedCategory = category.slug;
    setSidebarOpen(false);
    renderNav();
    loadInstructions();
  });
  return button;
}

function renderHeading(total) {
  if (state.query) {
    elements.title.textContent = state.selectedCategory
      ? `Поиск в разделе: ${selectedCategoryName()}`
      : "Результаты поиска";
    elements.resultCount.textContent = `Найдено: ${pluralizeInstructions(total)}`;
    return;
  }
  elements.title.textContent = selectedCategoryName();
  elements.resultCount.textContent = `Найдено: ${pluralizeInstructions(total)}`;
}

function renderError(message, retry) {
  elements.emptyState.hidden = true;
  elements.pagination.hidden = true;
  elements.list.setAttribute("aria-busy", "false");
  const box = createElement("div", "error-state");
  const icon = createElement("span", "error-icon");
  icon.append(createIcon("alert"));
  const button = createElement("button", "retry-button", "Повторить");
  button.type = "button";
  button.addEventListener("click", retry);
  box.append(
    icon,
    createElement("h2", "", "Данные временно недоступны"),
    createElement("p", "", message),
    button,
  );
  elements.list.replaceChildren(box);
}

async function loadCategories() {
  try {
    const data = await fetchJson(`${API_BASE}/categories`);
    state.categories = Array.isArray(data?.items) ? data.items : [];
    renderNav();
  } catch (error) {
    renderError(error.message || "Не удалось загрузить разделы.", loadCategories);
    showToast("Не удалось загрузить разделы");
  }
}

async function loadInstructions() {
  if (state.listRequest) state.listRequest.abort();
  state.listRequest = new AbortController();
  const signal = state.listRequest.signal;
  setListLoading();

  const params = new URLSearchParams({
    limit: String(LIST_FETCH_LIMIT),
    offset: "0",
  });
  if (state.selectedCategory) params.set("category", state.selectedCategory);
  if (state.query) params.set("q", state.query);

  try {
    const firstPage = await fetchInstructionPage(params, signal);
    const items = Array.isArray(firstPage?.items) ? [...firstPage.items] : [];
    const total = Number.isInteger(firstPage?.total) ? firstPage.total : items.length;
    let offset = items.length;

    while (offset < total) {
      const nextParams = new URLSearchParams(params);
      nextParams.set("offset", String(offset));
      const nextPage = await fetchInstructionPage(nextParams, signal);
      const nextItems = Array.isArray(nextPage?.items) ? nextPage.items : [];
      if (!nextItems.length) break;
      items.push(...nextItems);
      offset += nextItems.length;
    }

    renderInstructions({
      ...firstPage,
      items,
      total,
      limit: LIST_FETCH_LIMIT,
      offset: 0,
    });
    scrollContentToTop();
  } catch (error) {
    if (error.name !== "AbortError") {
      renderError(error.status === 503
        ? "API не может подключиться к базе данных. Проверьте PostgreSQL и переменные окружения."
        : error.message || "Не удалось загрузить инструкции.",
      loadInstructions);
    }
  }
}

function fetchInstructionPage(params, signal) {
  return fetchJson(`${API_BASE}/instructions?${params}`, { signal });
}

function scrollContentToTop() {
  elements.contentShell?.scrollTo({ top: 0, behavior: "smooth" });
}

function renderInstructions(data) {
  elements.list.setAttribute("aria-busy", "false");
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number.isInteger(data?.total) ? data.total : items.length;
  state.totalItems = total;
  renderHeading(total);

  if (!items.length) {
    elements.list.replaceChildren();
    elements.emptyState.hidden = false;
    elements.pagination.hidden = true;
    return;
  }

  elements.emptyState.hidden = true;
  const fragment = document.createDocumentFragment();
  items.forEach((instruction) => fragment.append(createInstructionCard(instruction)));
  elements.list.replaceChildren(fragment);
  elements.pagination.replaceChildren();
  elements.pagination.hidden = true;
}

function shouldIgnorePagingShortcut(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return true;
  const target = event.target;
  if (!target) return false;
  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

function scrollContentByPage(direction) {
  const scroller = elements.contentShell || document.scrollingElement;
  if (!scroller) return false;

  const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
  const atStart = scroller.scrollTop <= 2;
  const atEnd = scroller.scrollTop >= maxScrollTop - 2;
  if (direction > 0 && atEnd) return false;
  if (direction < 0 && atStart) return false;

  scroller.scrollBy({
    top: direction * Math.max(220, scroller.clientHeight * 0.82),
    behavior: "smooth",
  });
  return true;
}

function handlePageKey(event) {
  if (shouldIgnorePagingShortcut(event)) return;
  if (elements.imageViewer && !elements.imageViewer.hidden) return;

  const direction = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
  if (!direction) return;

  if (scrollContentByPage(direction)) event.preventDefault();
}

function createInstructionCard(instruction) {
  const card = createElement("article", "instruction-card");
  const header = createElement("button", "accordion-header");
  header.type = "button";
  header.setAttribute("aria-expanded", "false");

  const copy = createElement("span", "instruction-copy");
  copy.append(
    createElement("span", "instruction-category", instruction.category.name),
    createElement("h2", "instruction-title", instruction.title),
  );
  if (instruction.summary) copy.append(createElement("p", "instruction-summary", instruction.summary));

  const chevron = createElement("span", "chevron-box");
  chevron.append(createIcon("chevron"));

  const content = createElement("div", "accordion-content");
  content.hidden = true;

  header.append(copy, chevron);
  header.addEventListener("click", () => toggleInstruction(card, header, content, instruction));
  card.append(header, content);
  return card;
}

async function toggleInstruction(card, header, content, instruction) {
  const isOpen = card.classList.toggle("is-open");
  header.setAttribute("aria-expanded", String(isOpen));
  content.hidden = !isOpen;
  if (!isOpen || content.dataset.loaded === "true") return;

  content.replaceChildren(createElement("div", "content-inner", "Загрузка инструкции..."));
  try {
    const detail = await getInstructionDetail(instruction);
    const inner = createElement("div", "content-inner");
    inner.append(renderContent(detail.content));
    content.replaceChildren(inner);
    content.dataset.loaded = "true";
  } catch (error) {
    const inner = createElement("div", "content-inner");
    inner.append(createElement("p", "", error.message || "Не удалось открыть инструкцию."));
    content.replaceChildren(inner);
  }
}

async function getInstructionDetail(instruction) {
  const key = `${instruction.category.slug}/${instruction.slug}`;
  if (state.detailCache.has(key)) return state.detailCache.get(key);
  const detail = await fetchJson(
    `${API_BASE}/instructions/by-slug/${encodeURIComponent(instruction.category.slug)}/${encodeURIComponent(instruction.slug)}`,
  );
  state.detailCache.set(key, detail);
  return detail;
}

function appendTextBlock(parent, text) {
  if (text === undefined || text === null || String(text).trim() === "") return;
  parent.append(createElement("p", "", text));
}

function safeWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!url.pathname.startsWith("/assets/")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderContent(content) {
  const container = document.createDocumentFragment();
  let blocks = [];
  if (Array.isArray(content)) blocks = content;
  else if (content && typeof content === "object" && Array.isArray(content.blocks)) blocks = content.blocks;
  else if (content && typeof content === "object" && content.text) blocks = [content];

  if (!blocks.length) {
    container.append(createElement("pre", "json-fallback", JSON.stringify(content, null, 2)));
    return container;
  }

  blocks.forEach((block) => renderBlock(block, container));
  return container;
}

function renderBlock(block, parent) {
  if (typeof block === "string") {
    appendTextBlock(parent, block);
    return;
  }
  if (!block || typeof block !== "object" || Array.isArray(block)) return;

  const type = String(block.type || "paragraph").toLowerCase();
  const text = block.text ?? block.content ?? "";

  if (["heading", "title", "subtitle"].includes(type)) {
    const level = Math.min(4, Math.max(2, Number(block.level) || (type === "subtitle" ? 3 : 2)));
    parent.append(createElement(`h${level}`, "", text));
    return;
  }

  if (["paragraph", "text"].includes(type)) {
    appendTextBlock(parent, text);
    return;
  }

  if (["list", "unordered-list", "ordered-list"].includes(type)) {
    const ordered = type === "ordered-list" || block.ordered === true;
    const list = createElement(ordered ? "ol" : "ul");
    const items = Array.isArray(block.items) ? block.items : [];
    items.forEach((item) => {
      const value = typeof item === "object" && item !== null ? item.text ?? item.title : item;
      list.append(createElement("li", "", value ?? ""));
    });
    parent.append(list);
    return;
  }

  if (["steps", "step-list"].includes(type)) {
    const list = createElement("ol", "instruction-steps");
    const items = Array.isArray(block.items) ? block.items : Array.isArray(block.steps) ? block.steps : [];
    items.forEach((item) => {
      const row = createElement("li", "instruction-step");
      if (typeof item === "string") {
        row.textContent = item;
      } else if (item && typeof item === "object") {
        const title = item.title ?? item.name;
        const description = item.text ?? item.description ?? item.content;
        if (title) row.append(createElement("strong", "", title));
        if (description) row.append(createElement("span", "", description));
      }
      list.append(row);
    });
    parent.append(list);
    return;
  }

  if (["note", "info", "warning", "danger"].includes(type)) {
    const variant = type === "warning" || block.variant === "warning"
      ? "warning"
      : type === "danger" || block.variant === "danger"
        ? "danger"
        : "";
    const note = createElement("aside", `instruction-note${variant ? ` ${variant}` : ""}`);
    if (block.title) note.append(createElement("strong", "", block.title));
    note.append(document.createTextNode(String(text || block.message || "")));
    parent.append(note);
    return;
  }

  if (type === "code") {
    parent.append(createElement("pre", "instruction-code", block.code ?? text));
    return;
  }

  if (type === "divider") {
    parent.append(document.createElement("hr"));
    return;
  }

  if (type === "link") {
    const href = safeWebUrl(block.url ?? block.href);
    if (!href) return;
    const link = createElement("a", "instruction-link", block.label ?? block.title ?? href);
    link.href = href;
    if (new URL(href).origin !== window.location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    const paragraph = createElement("p");
    paragraph.append(link);
    parent.append(paragraph);
    return;
  }

  if (["image", "screenshot"].includes(type)) {
    renderImageBlock(block, parent);
    return;
  }

  if (["gallery", "images", "screenshots"].includes(type)) {
    const items = Array.isArray(block.items)
      ? block.items
      : Array.isArray(block.images)
        ? block.images
        : Array.isArray(block.screenshots)
          ? block.screenshots
          : [];
    const gallery = createElement("div", "instruction-gallery");
    items.forEach((item) => renderImageBlock(item, gallery));
    if (gallery.childElementCount) parent.append(gallery);
    return;
  }

  if (Array.isArray(block.blocks)) {
    block.blocks.forEach((child) => renderBlock(child, parent));
    return;
  }

  if (text) appendTextBlock(parent, text);
}

function renderImageBlock(block, parent) {
  const src = safeImageUrl(block.url ?? block.src ?? block.href);
  if (!src) return;
  const caption = block.caption ?? block.title ?? "";
  const alt = String(block.alt || caption || "Скриншот инструкции");
  const figure = createElement("figure", "instruction-figure");
  const button = createElement("button", "instruction-image-button");
  button.type = "button";
  button.setAttribute("aria-label", "Открыть скриншот");
  const image = createElement("img", "instruction-image");
  image.src = src;
  image.alt = alt;
  image.loading = "lazy";
  image.addEventListener("error", () => figure.remove());
  button.append(image);
  button.addEventListener("click", () => showImageViewer(src, alt, caption));
  figure.append(button);
  if (caption) figure.append(createElement("figcaption", "instruction-caption", caption));
  parent.append(figure);
}

function showImageViewer(src, alt, caption) {
  if (!elements.imageViewer) return;
  elements.imageViewerImage.src = src;
  elements.imageViewerImage.alt = alt;
  elements.imageViewerCaption.textContent = caption || alt;
  elements.imageViewerCaption.hidden = !(caption || alt);
  elements.imageViewer.hidden = false;
  document.body.classList.add("is-modal-open");
  elements.imageViewerClose.focus();
}

function closeImageViewer() {
  if (!elements.imageViewer || elements.imageViewer.hidden) return;
  elements.imageViewer.hidden = true;
  elements.imageViewerImage.src = "";
  elements.imageViewerImage.alt = "";
  elements.imageViewerCaption.textContent = "";
  document.body.classList.remove("is-modal-open");
}

const applySearch = debounce(() => {
  state.query = elements.searchInput.value.trim();
  elements.clearSearchButton.hidden = !state.query;
  loadInstructions();
}, 250);

elements.searchForm.addEventListener("submit", (event) => event.preventDefault());
elements.searchInput.addEventListener("input", applySearch);
elements.clearSearchButton.addEventListener("click", () => {
  elements.searchInput.value = "";
  state.query = "";
  elements.clearSearchButton.hidden = true;
  elements.searchInput.focus();
  loadInstructions();
});

elements.resetFiltersButton.addEventListener("click", () => {
  state.selectedCategory = null;
  state.query = "";
  elements.searchInput.value = "";
  elements.clearSearchButton.hidden = true;
  renderNav();
  loadInstructions();
});

elements.mobileMenuButton.addEventListener("click", () => setSidebarOpen(true));
elements.closeSidebarButton.addEventListener("click", () => setSidebarOpen(false));
elements.mobileOverlay.addEventListener("click", () => setSidebarOpen(false));
elements.imageViewerClose.addEventListener("click", closeImageViewer);
elements.imageViewerBackdrop.addEventListener("click", closeImageViewer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImageViewer();
    return;
  }
  handlePageKey(event);
});

async function init() {
  await loadCategories();
  await loadInstructions();
}

document.addEventListener("DOMContentLoaded", init);
