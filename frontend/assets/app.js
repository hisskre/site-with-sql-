"use strict";

const API_BASE = "/api/v1";

const categoryVisuals = {
  "printers-and-scanners": ["printer", "#eef5ff", "#3478f6"],
  outlook: ["mail", "#f0f0ff", "#6b63d9"],
  "password-reset": ["key", "#fff4e8", "#d9780d"],
  terminals: ["terminal", "#eaf8f3", "#1d9a6c"],
  users: ["user", "#fff0f3", "#d55473"],
  forticlient: ["shield", "#edf7f7", "#20898d"],
  "wifi-and-internet": ["wifi", "#eef5ff", "#3478f6"],
  "mts-link": ["video", "#fff0f0", "#d84a4a"],
  "computers-and-laptops": ["laptop", "#f0f0ff", "#685fd1"],
  peripherals: ["mouse", "#f3f6ed", "#68833d"],
  other: ["more", "#f0f2f6", "#68748a"],
};

const state = {
  categories: [],
  categoriesStatus: "loading",
  selectedCategory: null,
  query: "",
  listRequest: null,
  lastCatalogHash: "#/",
  toastTimer: null,
};

const elements = {
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  categoryNav: document.querySelector("#category-nav"),
  categoryGrid: document.querySelector("#category-grid"),
  categorySection: document.querySelector("#category-section"),
  sidebarTotal: document.querySelector("#sidebar-total"),
  pageTitle: document.querySelector("#page-title"),
  pageDescription: document.querySelector("#page-description"),
  instructionsKicker: document.querySelector("#instructions-kicker"),
  instructionsTitle: document.querySelector("#instructions-title"),
  resultCount: document.querySelector("#result-count"),
  instructionList: document.querySelector("#instruction-list"),
  catalogView: document.querySelector("#catalog-view"),
  instructionView: document.querySelector("#instruction-view"),
  instructionDetail: document.querySelector("#instruction-detail"),
  backButton: document.querySelector("#back-button"),
  toast: document.querySelector("#toast"),
};

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function createIcon(name, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function visualFor(categorySlug) {
  return categoryVisuals[categorySlug] || categoryVisuals.other;
}

function pluralizeInstructions(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} инструкция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} инструкции`;
  }
  return `${count} инструкций`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
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
  }, 3400);
}

function setListLoading() {
  elements.instructionList.setAttribute("aria-busy", "true");
  elements.instructionList.replaceChildren(
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
  );
  elements.resultCount.textContent = "—";
}

function createCategoryButton(category, variant) {
  const visual = visualFor(category.slug);
  const button = createElement("button", variant === "card" ? "category-card" : "category-link");
  button.type = "button";
  button.dataset.category = category.slug;
  button.setAttribute("aria-pressed", String(state.selectedCategory === category.slug));
  if (state.selectedCategory === category.slug) button.classList.add("is-active");

  if (variant === "card") {
    const icon = createElement("span", "category-card-icon");
    icon.style.setProperty("--category-bg", visual[1]);
    icon.style.setProperty("--category-color", visual[2]);
    icon.append(createIcon(visual[0]));

    const copy = createElement("span", "category-card-copy");
    copy.append(
      createElement("strong", "", category.name),
      createElement("span", "", pluralizeInstructions(category.instruction_count)),
    );
    button.append(icon, copy, createIcon("chevron"));
  } else {
    const icon = createElement("span", "nav-icon");
    icon.append(createIcon(visual[0]));
    button.append(
      icon,
      createElement("span", "category-name", category.name),
      createElement("span", "category-count", category.instruction_count),
    );
  }

  button.addEventListener("click", () => selectCategory(category.slug));
  return button;
}

function renderCategories() {
  if (state.categoriesStatus === "error") return;
  const total = state.categories.reduce((sum, item) => sum + item.instruction_count, 0);
  elements.sidebarTotal.textContent = String(total);

  const allButton = createElement("button", "category-link");
  allButton.type = "button";
  allButton.setAttribute("aria-pressed", String(state.selectedCategory === null));
  if (state.selectedCategory === null) allButton.classList.add("is-active");
  const allIcon = createElement("span", "nav-icon");
  allIcon.append(createIcon("grid"));
  allButton.append(
    allIcon,
    createElement("span", "category-name", "Все инструкции"),
    createElement("span", "category-count", total),
  );
  allButton.addEventListener("click", () => selectCategory(null));

  const navFragment = document.createDocumentFragment();
  navFragment.append(allButton);
  const gridFragment = document.createDocumentFragment();
  state.categories.forEach((category) => {
    navFragment.append(createCategoryButton(category, "nav"));
    gridFragment.append(createCategoryButton(category, "card"));
  });
  elements.categoryNav.replaceChildren(navFragment);
  elements.categoryGrid.replaceChildren(gridFragment);
}

function renderCategoryError(error) {
  const text = createElement("p", "", "Разделы временно недоступны");
  const button = createElement("button", "retry-button", "Повторить");
  button.type = "button";
  button.addEventListener("click", loadCategories);
  elements.categoryNav.replaceChildren(text, button);
  elements.categoryGrid.replaceChildren();
  elements.sidebarTotal.textContent = "—";
  showToast(error.message || "Не удалось загрузить разделы");
}

async function loadCategories() {
  try {
    const data = await fetchJson(`${API_BASE}/categories`);
    state.categories = Array.isArray(data?.items) ? data.items : [];
    state.categoriesStatus = "ready";
    renderCategories();
  } catch (error) {
    state.categoriesStatus = "error";
    renderCategoryError(error);
  }
}

function categoryBySlug(slug) {
  return state.categories.find((item) => item.slug === slug) || null;
}

function updateCatalogHeading() {
  const category = categoryBySlug(state.selectedCategory);
  if (state.query) {
    elements.pageTitle.textContent = `Результаты поиска: «${state.query}»`;
    elements.pageDescription.textContent = category
      ? `Ищем совпадения в разделе «${category.name}».`
      : "Ищем совпадения по названиям во всех разделах.";
    elements.instructionsKicker.textContent = "Результаты поиска";
    elements.instructionsTitle.textContent = category ? category.name : "Найденные инструкции";
    return;
  }
  if (category) {
    elements.pageTitle.textContent = category.name;
    elements.pageDescription.textContent = "Все опубликованные инструкции выбранного раздела.";
    elements.instructionsKicker.textContent = "Выбранный раздел";
    elements.instructionsTitle.textContent = "Инструкции";
    return;
  }
  elements.pageTitle.textContent = "Ответы на частые вопросы";
  elements.pageDescription.textContent = "Пошаговые инструкции помогут быстро решить типовые технические задачи.";
  elements.instructionsKicker.textContent = "Все материалы";
  elements.instructionsTitle.textContent = "Последние инструкции";
}

function createInstructionCard(instruction) {
  const button = createElement("button", "instruction-card");
  button.type = "button";
  button.setAttribute("aria-label", `Открыть инструкцию «${instruction.title}»`);

  const icon = createElement("span", "instruction-icon");
  icon.append(createIcon("doc"));

  const copy = createElement("span", "instruction-copy");
  copy.append(createElement("span", "instruction-title", instruction.title));
  copy.append(
    createElement(
      "span",
      "instruction-summary",
      instruction.summary || "Открыть пошаговую инструкцию",
    ),
  );

  const meta = createElement("span", "instruction-meta");
  meta.append(
    createElement("span", "category-pill", instruction.category.name),
    createElement("span", "", `Обновлено ${formatDate(instruction.updated_at)}`),
  );

  button.append(icon, copy, meta, createIcon("chevron"));
  button.addEventListener("click", () => {
    state.lastCatalogHash = filtersHash();
    window.location.hash = `#/instruction/${encodeURIComponent(instruction.category.slug)}/${encodeURIComponent(instruction.slug)}`;
  });
  return button;
}

function renderInstructions(data) {
  elements.instructionList.setAttribute("aria-busy", "false");
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number.isInteger(data?.total) ? data.total : items.length;
  elements.resultCount.textContent = pluralizeInstructions(total);

  if (!items.length) {
    const box = createElement("div", "empty-state");
    const icon = createElement("span", "empty-state-icon");
    icon.append(createIcon("search"));
    box.append(
      icon,
      createElement("h3", "", "Ничего не найдено"),
      createElement(
        "p",
        "",
        state.query
          ? "Попробуйте изменить запрос или выбрать другой раздел."
          : "В этом разделе пока нет опубликованных инструкций.",
      ),
    );
    elements.instructionList.replaceChildren(box);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((instruction) => fragment.append(createInstructionCard(instruction)));
  elements.instructionList.replaceChildren(fragment);
}

function renderListError(error) {
  elements.instructionList.setAttribute("aria-busy", "false");
  elements.resultCount.textContent = "Ошибка";
  const box = createElement("div", "error-state");
  const icon = createElement("span", "error-state-icon");
  icon.append(createIcon("alert"));
  const message = error.status === 503
    ? "Сервис не может подключиться к базе данных. Проверьте настройки подключения."
    : error.message || "Не удалось получить инструкции.";
  const retry = createElement("button", "retry-button", "Повторить");
  retry.type = "button";
  retry.addEventListener("click", loadInstructions);
  box.append(icon, createElement("h3", "", "Инструкции недоступны"), createElement("p", "", message), retry);
  elements.instructionList.replaceChildren(box);
}

async function loadInstructions() {
  if (state.listRequest) state.listRequest.abort();
  state.listRequest = new AbortController();
  setListLoading();
  updateCatalogHeading();

  const params = new URLSearchParams({ limit: "100", offset: "0" });
  if (state.query) params.set("q", state.query);
  if (state.selectedCategory) params.set("category", state.selectedCategory);

  try {
    const data = await fetchJson(`${API_BASE}/instructions?${params}`, {
      signal: state.listRequest.signal,
    });
    renderInstructions(data);
  } catch (error) {
    if (error.name !== "AbortError") renderListError(error);
  }
}

function filtersHash() {
  const params = new URLSearchParams();
  if (state.selectedCategory) params.set("category", state.selectedCategory);
  if (state.query) params.set("q", state.query);
  const queryString = params.toString();
  return queryString ? `#/?${queryString}` : "#/";
}

function selectCategory(slug) {
  state.selectedCategory = slug;
  const hash = filtersHash();
  if (window.location.hash === hash) {
    renderCategories();
    loadInstructions();
  } else {
    window.location.hash = hash;
  }
}

function showCatalog() {
  elements.instructionView.hidden = true;
  elements.catalogView.hidden = false;
  elements.searchForm.hidden = false;
}

function showDetailLoading() {
  elements.catalogView.hidden = true;
  elements.instructionView.hidden = false;
  elements.searchForm.hidden = true;
  elements.instructionDetail.replaceChildren(
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
    createElement("div", "card-skeleton"),
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
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

  if (type === "image") {
    const src = safeWebUrl(block.url ?? block.src);
    if (!src) return;
    const image = createElement("img", "instruction-image");
    image.src = src;
    image.alt = String(block.alt || "Иллюстрация к инструкции");
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    parent.append(image);
    if (block.caption) parent.append(createElement("p", "instruction-caption", block.caption));
    return;
  }

  if (Array.isArray(block.blocks)) {
    block.blocks.forEach((child) => renderBlock(child, parent));
    return;
  }

  if (text) appendTextBlock(parent, text);
}

function renderContent(content) {
  const container = createElement("div", "detail-content");
  let blocks = [];
  if (Array.isArray(content)) blocks = content;
  else if (content && typeof content === "object" && Array.isArray(content.blocks)) blocks = content.blocks;
  else if (content && typeof content === "object" && content.text) blocks = [content];

  if (blocks.length) {
    blocks.forEach((block) => renderBlock(block, container));
  } else {
    container.append(createElement("pre", "json-fallback", JSON.stringify(content, null, 2)));
  }
  return container;
}

function renderInstructionDetail(instruction) {
  document.title = `${instruction.title} — База знаний`;
  const shell = createElement("div", "detail-shell");
  const header = createElement("header", "detail-header");
  const breadcrumb = createElement("div", "detail-breadcrumb");
  breadcrumb.append(
    createElement("span", "", "База знаний"),
    createIcon("chevron"),
    createElement("span", "", instruction.category.name),
  );
  header.append(breadcrumb, createElement("h1", "", instruction.title));
  if (instruction.summary) header.append(createElement("p", "detail-summary", instruction.summary));

  const meta = createElement("div", "detail-meta");
  const updated = createElement("span");
  updated.append(createIcon("clock"), document.createTextNode(`Обновлено ${formatDate(instruction.updated_at)}`));
  meta.append(updated);

  if (Array.isArray(instruction.tags) && instruction.tags.length) {
    const tags = createElement("span", "detail-tags");
    instruction.tags.forEach((tag) => tags.append(createElement("span", "detail-tag", tag)));
    meta.append(tags);
  }
  header.append(meta);
  shell.append(header, renderContent(instruction.content));
  elements.instructionDetail.replaceChildren(shell);
}

function renderDetailError(error) {
  const box = createElement("div", "error-state");
  const icon = createElement("span", "error-state-icon");
  icon.append(createIcon("alert"));
  box.append(
    icon,
    createElement("h3", "", error.status === 404 ? "Инструкция не найдена" : "Не удалось открыть инструкцию"),
    createElement("p", "", error.message || "Попробуйте вернуться к списку и открыть материал снова."),
  );
  elements.instructionDetail.replaceChildren(box);
}

async function openInstruction(categorySlug, instructionSlug) {
  showDetailLoading();
  try {
    const instruction = await fetchJson(
      `${API_BASE}/instructions/by-slug/${encodeURIComponent(categorySlug)}/${encodeURIComponent(instructionSlug)}`,
    );
    renderInstructionDetail(instruction);
  } catch (error) {
    renderDetailError(error);
  }
}

function parseCatalogHash() {
  const raw = window.location.hash.startsWith("#/?") ? window.location.hash.slice(3) : "";
  const params = new URLSearchParams(raw);
  const category = params.get("category");
  state.selectedCategory = category && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category) ? category : null;
  state.query = (params.get("q") || "").trim().slice(0, 200);
  elements.searchInput.value = state.query;
}

function route() {
  const detailMatch = window.location.hash.match(/^#\/instruction\/([^/]+)\/([^/]+)$/);
  if (detailMatch) {
    openInstruction(decodeURIComponent(detailMatch[1]), decodeURIComponent(detailMatch[2]));
    return;
  }

  document.title = "База знаний — ИТ-поддержка";
  parseCatalogHash();
  state.lastCatalogHash = filtersHash();
  showCatalog();
  renderCategories();
  loadInstructions();
}

const delayedSearch = debounce(() => {
  state.query = elements.searchInput.value.trim();
  window.history.replaceState(null, "", filtersHash());
  loadInstructions();
}, 320);

elements.searchInput.addEventListener("input", delayedSearch);
elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = elements.searchInput.value.trim();
  window.history.replaceState(null, "", filtersHash());
  loadInstructions();
});

elements.backButton.addEventListener("click", () => {
  window.location.hash = state.lastCatalogHash;
});

document.querySelectorAll("[data-home-link]").forEach((link) => {
  link.addEventListener("click", () => {
    state.selectedCategory = null;
    state.query = "";
    elements.searchInput.value = "";
  });
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!elements.searchForm.hidden) elements.searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === elements.searchInput) {
    elements.searchInput.blur();
  }
});

window.addEventListener("hashchange", route);

async function init() {
  await loadCategories();
  route();
}

init();
