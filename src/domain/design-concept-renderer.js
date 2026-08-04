/**
 * Foundry's canonical visual-concept renderer.
 *
 * The studio and the production contract both consume this exact renderer
 * contract. The studio renders the returned document; generation receives the
 * same contract and must preserve its id, tokens, regions, and responsive rule.
 */

import { createProductRenderSpec } from "./product-render-spec.js";

const VERSION = "2.0.0";

const AUTHENTICATION_PATTERN = /\b(?:sign[\s-]?in|log[\s-]?in|auth(?:enticate|entication)?|credentials?|password|account access)\b/iu;
const REGISTRATION_PATTERN = /\b(?:sign[\s-]?up|register|registration|create (?:an )?account|join)\b/iu;

function isAuthenticationText(value) {
  const valueText = text(value);
  return AUTHENTICATION_PATTERN.test(valueText) || REGISTRATION_PATTERN.test(valueText);
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function list(value, fallback = []) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [...fallback];
}

function hash(value) {
  const source = JSON.stringify(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `fdr-${(result >>> 0).toString(16).padStart(8, "0")}`;
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fontStack(voice) {
  if (/serif/u.test(voice)) return 'Georgia, "Iowan Old Style", "Times New Roman", serif';
  if (/mono|technical/u.test(voice)) return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  if (/humanist/u.test(voice)) return 'Avenir, "Segoe UI", Candara, sans-serif';
  return 'Inter, "Helvetica Neue", Arial, sans-serif';
}

function primitiveFamily(primitive) {
  if (["immersive-hero", "narrative-scroll", "asymmetric-split", "editorial-spread"].includes(primitive)) return "editorial";
  if (["modular-gallery", "catalog", "map-led"].includes(primitive)) return "gallery";
  if (["guided-flow", "mobile-stacked"].includes(primitive)) return "guided";
  if (["documentation-explorer", "command-surface"].includes(primitive)) return "technical";
  return "workspace";
}

const RENDERER_REQUIREMENTS = Object.freeze({
  editorial: Object.freeze({
    rootClass: "concept-editorial",
    responsiveClass: "concept-hero",
    requiredClasses: Object.freeze([
      "concept-nav",
      "concept-editorial",
      "concept-hero",
      "concept-photo-hero",
      "concept-hero-copy",
      "concept-spread",
    ]),
    structuralRules: Object.freeze([
      ".concept-hero uses the canonical 1.55fr / .75fr desktop grid",
      ".concept-spread uses the canonical .65fr / 1fr / 1.35fr desktop grid",
      "at 560px or below .concept-hero collapses to one column",
    ]),
  }),
  gallery: Object.freeze({
    rootClass: "concept-gallery",
    responsiveClass: "concept-gallery",
    requiredClasses: Object.freeze([
      "concept-nav",
      "concept-nav-ruled",
      "concept-gallery",
      "concept-filters",
      "concept-grid",
      "concept-photo",
    ]),
    structuralRules: Object.freeze([
      ".concept-gallery uses the canonical 185px / 1fr desktop grid",
      ".concept-grid uses the canonical four-column desktop grid",
      "at 560px or below .concept-gallery collapses to one column and .concept-grid to two columns",
    ]),
  }),
  workspace: Object.freeze({
    rootClass: "concept-workspace",
    responsiveClass: "concept-workspace",
    requiredClasses: Object.freeze([
      "concept-workspace",
      "concept-metrics",
      "concept-table",
    ]),
    structuralRules: Object.freeze([
      ".concept-workspace uses the canonical 150px / 1fr desktop grid",
      ".concept-metrics uses the canonical three-column desktop grid",
      "at 560px or below .concept-workspace collapses to one column and its aside is hidden",
    ]),
  }),
  guided: Object.freeze({
    rootClass: "concept-guided",
    responsiveClass: "concept-guided",
    requiredClasses: Object.freeze([
      "concept-guided",
      "concept-guided-story",
      "concept-form",
    ]),
    structuralRules: Object.freeze([
      ".concept-guided uses the canonical 1.15fr / .85fr desktop grid",
      ".concept-guided-story keeps the approved dark narrative surface",
      "at 560px or below .concept-guided collapses to one column",
    ]),
  }),
  technical: Object.freeze({
    rootClass: "concept-technical",
    responsiveClass: "concept-technical",
    requiredClasses: Object.freeze([
      "concept-nav",
      "concept-nav-dark",
      "concept-technical",
      "concept-code",
    ]),
    structuralRules: Object.freeze([
      ".concept-technical uses the canonical 165px / 1fr desktop grid",
      ".concept-code preserves the approved command surface",
      "at 560px or below .concept-technical collapses to one column and its aside is hidden",
    ]),
  }),
});

export function designRendererRequirements(contract) {
  const family = text(contract?.family, primitiveFamily(text(contract?.primitive)));
  const requirements = RENDERER_REQUIREMENTS[family] ?? RENDERER_REQUIREMENTS.workspace;
  return Object.freeze({
    rendererVersion: VERSION,
    family,
    rootClass: requirements.rootClass,
    responsiveClass: requirements.responsiveClass,
    requiredClasses: Object.freeze([
      `concept-${text(contract?.primitive, "task-workspace")}`,
      ...(contract?.authentication?.required
        ? ["concept-journey", "concept-auth-surface", "concept-auth-form", "concept-product-surface"]
        : []),
      ...requirements.requiredClasses,
    ]),
    structuralRules: Object.freeze([
      `The approved ${text(contract?.primitive, "task-workspace")} primitive keeps its dedicated composition overrides in addition to the shared ${family} geometry`,
      ...(contract?.authentication?.required
        ? [
            ".concept-journey shows secure access and the post-authentication product as separate canonical surfaces",
            ".concept-auth-form contains labeled identity and password controls plus a submit action",
            "at 520px or below .concept-journey prioritizes the authentication surface in one column",
          ]
        : []),
      ...requirements.structuralRules,
    ]),
    responsiveBreakpointPx: 560,
  });
}

export function createDesignRenderContract(input) {
  const colors = input.visualSystem?.colorRoles ?? input.colors ?? {};
  const dna = input.creativeDNA ?? {};
  const labels = list(dna.surfaceLabels, list(input.visualSystem?.sampleLabels, ["Overview", "Work", "Details", "Contact"]));
  const regions = list(dna.surfaceSequence, labels).slice(0, 6);
  const workflows = list(input.workflows, regions).slice(0, 4);
  const primitive = text(dna.compositionPrimitive, text(input.visualSystem?.layoutType, "editorial-spread"));
  const experienceText = [input.outcome, ...workflows, ...regions, ...labels].join(" ");
  const authenticationMode = REGISTRATION_PATTERN.test(experienceText) ? "sign-up" : "sign-in";
  const productRenderSpec = createProductRenderSpec({
    productName: input.productName,
    outcome: input.outcome,
    workflows,
    capabilities: input.capabilities,
    audiences: input.audiences,
    dataConcepts: input.dataConcepts,
    surfaceLabels: [...regions, ...labels],
    primaryAction: text(dna.primaryAction, input.visualSystem?.sampleLabels?.[0] ?? "Get started"),
  });
  const draft = {
    rendererVersion: VERSION,
    productName: text(input.productName, "Your product"),
    outcome: text(input.outcome, text(dna.thesis, "A complete product experience.")),
    directionName: text(input.directionName, "Design direction"),
    personality: text(input.personality, text(dna.emotionalGoal, "Clear and considered")),
    primitive,
    family: primitiveFamily(primitive),
    regions,
    labels,
    workflows,
    authentication: {
      required: AUTHENTICATION_PATTERN.test(experienceText) || REGISTRATION_PATTERN.test(experienceText),
      mode: authenticationMode,
      title: authenticationMode === "sign-up" ? "Create your account" : "Welcome back",
      identityLabel: "Email address",
      secretLabel: "Password",
      actionLabel: authenticationMode === "sign-up" ? "Create account" : "Sign in",
      secondaryAction: authenticationMode === "sign-up" ? "Already have an account? Sign in" : "Forgot password?",
    },
    primaryAction: text(dna.primaryAction, input.visualSystem?.sampleLabels?.[0] ?? "Get started"),
    responsiveTransform: text(dna.responsiveTransform, "collapse-to-stack"),
    imageryTreatment: text(dna.imageryTreatment, text(input.visualSystem?.imageStrategy, "framed-plate")),
    motionStrategy: text(dna.motionStrategy, "restrained"),
    spacingRhythm: text(dna.spacingRhythm, text(input.visualSystem?.spacingProfile, "steady-beat")),
    surfaceDepth: text(dna.surfaceDepth, text(input.visualSystem?.surfaceTreatment, "hairline-ruled")),
    typeVoice: text(dna.typeVoice, text(input.visualSystem?.typographyCategory, "grotesque-neutral")),
    typeScale: text(dna.typeScale, "measured"),
    density: text(input.visualSystem?.density, "balanced"),
    navigationType: text(input.visualSystem?.navigationType, "top-bar"),
    layoutType: text(input.visualSystem?.layoutType, primitive),
    contentEmphasis: text(input.visualSystem?.contentEmphasis, "action"),
    interactionModel: text(input.visualSystem?.interactionModel, "direct"),
    buttonTreatment: text(input.visualSystem?.buttonTreatment, "solid"),
    colors: {
      background: text(colors.background, "#f5f3ee"),
      surface: text(colors.surface, "#ffffff"),
      primary: text(colors.primary, "#1f2937"),
      accent: text(colors.accent, "#b45309"),
      text: text(colors.text, "#171717"),
    },
    productRenderSpec,
  };
  return Object.freeze({ ...draft, renderContractId: hash(draft) });
}

function withoutAuthentication(items) {
  return items.filter((item) => !isAuthenticationText(item));
}

function productRegions(contract) {
  const regions = withoutAuthentication(contract.regions);
  return regions.length > 0 ? regions : ["Overview", "Primary workspace", "Account"];
}

function productLabels(contract) {
  const labels = withoutAuthentication(contract.labels);
  return labels.length > 0 ? labels : productRegions(contract);
}

function productWorkflows(contract) {
  const workflows = withoutAuthentication(contract.workflows);
  return workflows.length > 0 ? workflows : productRegions(contract);
}

function navigation(contract) {
  return productLabels(contract).slice(0, 4).map((label) => `<span>${escapeHtml(label)}</span>`).join("");
}

function editorialMarkup(contract) {
  const [first = "Overview", second = "Recent activity", third = "Account"] = productRegions(contract);
  return `
    <header class="concept-nav"><b>${escapeHtml(contract.productName)}</b><nav>${navigation(contract)}</nav></header>
    <main class="concept-editorial">
      <section class="concept-hero">
        <div class="concept-photo concept-photo-hero"><span>01</span></div>
        <div class="concept-hero-copy"><small>${escapeHtml(first)}</small><h1>${escapeHtml(contract.directionName)}</h1><p>${escapeHtml(contract.outcome)}</p><a>${escapeHtml(contract.primaryAction)} <i>↗</i></a></div>
      </section>
      <section class="concept-spread">
        <div><small>02 — ${escapeHtml(second)}</small><h2>${escapeHtml(contract.personality)}</h2></div>
        <div class="concept-photo concept-photo-tall"></div>
        <div class="concept-photo concept-photo-wide"></div>
        <p>${escapeHtml(productWorkflows(contract)[0] ?? third)}</p>
      </section>
    </main>`;
}

function galleryMarkup(contract) {
  const labels = productLabels(contract);
  const tiles = productRegions(contract).concat(labels).slice(0, 7);
  return `
    <header class="concept-nav concept-nav-ruled"><b>${escapeHtml(contract.productName)}</b><nav>${navigation(contract)}</nav><em>INDEX / 2026</em></header>
    <main class="concept-gallery">
      <aside><small>${escapeHtml(contract.directionName)}</small><h1>${escapeHtml(contract.outcome)}</h1><a>${escapeHtml(contract.primaryAction)} →</a></aside>
      <section><div class="concept-filters">${labels.slice(0, 4).map((label, index) => `<span class="${index === 0 ? "active" : ""}">${escapeHtml(label)}</span>`).join("")}</div><div class="concept-grid">${tiles.map((label, index) => `<figure class="tile-${(index % 4) + 1}"><div class="concept-photo"></div><figcaption><b>${String(index + 1).padStart(2, "0")}</b>${escapeHtml(label)}</figcaption></figure>`).join("")}</div></section>
    </main>`;
}

function workspaceMarkup(contract) {
  const labels = productLabels(contract);
  const regions = productRegions(contract);
  const workflows = productWorkflows(contract);
  return `
    <main class="concept-workspace">
      <aside><b>${escapeHtml(contract.productName)}</b><nav>${labels.slice(0, 5).map((label, index) => `<span class="${index === 0 ? "active" : ""}">${escapeHtml(label)}</span>`).join("")}</nav><small>${escapeHtml(contract.directionName)}</small></aside>
      <section><header><div><small>Workspace</small><h1>${escapeHtml(regions[0] ?? "Overview")}</h1><p>${escapeHtml(contract.personality)}</p></div><button>${escapeHtml(contract.primaryAction)}</button></header><div class="concept-metrics">${workflows.slice(0, 3).map((item, index) => `<article><small>0${index + 1}</small><b>${escapeHtml(item)}</b><i></i></article>`).join("")}</div><div class="concept-table">${regions.slice(0, 5).map((item, index) => `<div><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(item)}</span><em>${index % 2 ? "Ready" : "Active"}</em></div>`).join("")}</div></section>
    </main>`;
}

function guidedMarkup(contract) {
  return `
    <main class="concept-guided"><section class="concept-guided-story"><b>${escapeHtml(contract.productName)}</b><small>${escapeHtml(contract.directionName)}</small><h1>${escapeHtml(contract.outcome)}</h1><ol>${contract.regions.slice(0, 4).map((item, index) => `<li><i>${index + 1}</i>${escapeHtml(item)}</li>`).join("")}</ol></section><section class="concept-form"><small>${escapeHtml(contract.labels[0] ?? "Welcome")}</small><h2>${escapeHtml(contract.primaryAction)}</h2>${contract.labels.slice(1, 4).map((label) => `<label>${escapeHtml(label)}<span></span></label>`).join("")}<button>${escapeHtml(contract.primaryAction)} →</button><p>${escapeHtml(contract.personality)}</p></section></main>`;
}

function technicalMarkup(contract) {
  return `
    <header class="concept-nav concept-nav-dark"><b>${escapeHtml(contract.productName)}</b><nav>${navigation(contract)}</nav></header><main class="concept-technical"><aside>${contract.regions.slice(0, 5).map((item, index) => `<span class="${index === 0 ? "active" : ""}">${escapeHtml(item)}</span>`).join("")}</aside><article><small>${escapeHtml(contract.directionName)}</small><h1>${escapeHtml(contract.outcome)}</h1><p>${escapeHtml(contract.personality)}</p><div class="concept-code"><i>GET</i><b>/v1/${escapeHtml(contract.labels[0] ?? "resource").toLowerCase().replaceAll(" ", "-")}</b><button>${escapeHtml(contract.primaryAction)}</button><pre>{\n  "status": "ready",\n  "experience": "${escapeHtml(contract.directionName)}"\n}</pre></div></article></main>`;
}

function legacyMarkup(contract) {
  const productContract = {
    ...contract,
    regions: productRegions(contract),
    labels: productLabels(contract),
    workflows: productWorkflows(contract),
  };
  let product;
  if (contract.family === "editorial") product = editorialMarkup(productContract);
  else if (contract.family === "gallery") product = galleryMarkup(productContract);
  else if (contract.family === "guided") product = guidedMarkup(productContract);
  else if (contract.family === "technical") product = technicalMarkup(productContract);
  else product = workspaceMarkup(productContract);
  if (!contract.authentication?.required) return product;
  return `<main class="concept-journey concept-journey-${escapeHtml(contract.family)} concept-journey-${escapeHtml(contract.primitive)}">
    <section class="concept-auth-surface">
      <div class="concept-auth-brand"><i></i><b>${escapeHtml(contract.productName)}</b></div>
      <div class="concept-auth-visual" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="concept-auth-copy"><small>${contract.authentication.mode === "sign-up" ? "New account" : "Secure access"}</small><h1>${escapeHtml(contract.authentication.title)}</h1><p>${contract.authentication.mode === "sign-up" ? `Set up secure access to ${escapeHtml(contract.productName)}.` : `Sign in to continue to your ${escapeHtml(productRegions(contract)[0] ?? "workspace").toLowerCase()}.`}</p></div>
      <form class="concept-auth-form">
        ${contract.authentication.mode === "sign-up" ? '<label>Full name<input type="text" name="name" autocomplete="name" placeholder="Your name" required></label>' : ""}
        <label>${escapeHtml(contract.authentication.identityLabel)}<input type="email" name="email" autocomplete="username" placeholder="name@company.com" required></label>
        <label>${escapeHtml(contract.authentication.secretLabel)}<input type="password" name="password" autocomplete="current-password" value="••••••••" required></label>
        <div><label class="concept-auth-check"><input type="checkbox" checked> ${contract.authentication.mode === "sign-up" ? "I agree to the terms" : "Keep me signed in"}</label><a>${escapeHtml(contract.authentication.secondaryAction)}</a></div>
        <button type="submit">${escapeHtml(contract.authentication.actionLabel)} <i>→</i></button>
        <p class="concept-auth-state"><i></i> Secure session · Help is available</p>
      </form>
    </section>
    <section class="concept-product-surface"><div class="concept-step-label"><b>After sign in</b><span>Functional product workspace</span></div>${product}</section>
  </main>`;
}

function screenFamilyComposition(contract, screen, index) {
  const regions = screen.regions;
  const regionCards = regions.map((region, regionIndex) => `
    <article class="concept-region-card" data-foundry-region="${escapeHtml(region.id)}">
      <div class="concept-region-index">${String(regionIndex + 1).padStart(2, "0")}</div>
      <div><small>${escapeHtml(region.kind.replaceAll("-", " "))}</small><h3>${escapeHtml(region.title)}</h3>
      <ul>${region.items.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <span class="concept-region-signal"></span>
    </article>`).join("");
  const commonHeader = `<header class="concept-screen-head"><div><small>${escapeHtml(screen.kind === "overview" ? "Workspace" : screen.eyebrow)}</small><h1>${escapeHtml(screen.title)}</h1><p>${escapeHtml(screen.summary)}</p></div><button type="button" data-foundry-next>${escapeHtml(screen.primaryAction)} <i>↗</i></button></header>`;

  if (contract.family === "editorial") return `<main class="concept-editorial concept-screen-composition"><section class="concept-hero"><div class="concept-photo concept-photo-hero"><span>${String(index + 1).padStart(2, "0")}</span><div class="concept-visual-word">${escapeHtml(screen.navLabel)}</div></div><div class="concept-hero-copy">${commonHeader}</div></section><section class="concept-spread">${regionCards}</section></main>`;
  if (contract.family === "gallery") return `<main class="concept-gallery concept-screen-composition"><aside><small>${escapeHtml(contract.directionName)}</small><h1>${escapeHtml(screen.title)}</h1><button type="button" data-foundry-next>${escapeHtml(screen.primaryAction)}</button></aside><section><div class="concept-filters">${screen.states.slice(0, 4).map((state, stateIndex) => `<button type="button" data-foundry-state="${state}" class="${stateIndex === 0 ? "active" : ""}">${state}</button>`).join("")}</div><div class="concept-grid">${regions.map((region, regionIndex) => `<figure class="tile-${regionIndex + 1}" data-foundry-region="${escapeHtml(region.id)}"><div class="concept-photo"><span>${escapeHtml(region.kind)}</span></div><figcaption><b>0${regionIndex + 1}</b>${escapeHtml(region.title)}</figcaption></figure>`).join("")}</div></section></main>`;
  if (contract.family === "guided") return `<main class="concept-guided concept-screen-composition"><section class="concept-guided-story"><small>${escapeHtml(screen.eyebrow)}</small><h1>${escapeHtml(screen.title)}</h1><p>${escapeHtml(screen.summary)}</p><ol>${regions.map((region, regionIndex) => `<li data-foundry-region="${escapeHtml(region.id)}"><i>${regionIndex + 1}</i>${escapeHtml(region.title)}</li>`).join("")}</ol></section><section class="concept-form"><small>${escapeHtml(contract.directionName)}</small><h2>${escapeHtml(screen.primaryAction)}</h2>${regions.map((region) => `<label data-foundry-region="${escapeHtml(region.id)}">${escapeHtml(region.title)}<span>${escapeHtml(region.items[0] ?? "")}</span></label>`).join("")}<button type="button" data-foundry-next>${escapeHtml(screen.primaryAction)} →</button></section></main>`;
  if (contract.family === "technical") return `<main class="concept-technical concept-screen-composition"><aside>${contract.productRenderSpec.navigation.map((item) => `<button type="button" data-foundry-screen-target="${escapeHtml(item.screenId)}">${escapeHtml(item.label)}</button>`).join("")}</aside><article>${commonHeader}<div class="concept-code" data-foundry-region="${escapeHtml(regions[0]?.id ?? screen.id)}"><i>${screen.kind === "technical" ? "POST" : "OPEN"}</i><b>/${escapeHtml(screen.id.replace(/^screen-\d+-/u, ""))}</b><button type="button" data-foundry-next>${escapeHtml(screen.primaryAction)}</button><pre>${escapeHtml(regions.map((region) => `${region.kind}: ${region.title}`).join("\n"))}</pre></div></article></main>`;
  return `<main class="concept-workspace concept-screen-composition"><section>${commonHeader}<div class="concept-metrics">${regions.map((region, regionIndex) => `<article data-foundry-region="${escapeHtml(region.id)}"><small>0${regionIndex + 1}</small><b>${escapeHtml(region.title)}</b><span>${escapeHtml(region.kind.replaceAll("-", " "))}</span><i></i></article>`).join("")}</div><div class="concept-table">${regionCards}</div></section></main>`;
}

function authenticationPanel(contract, screen) {
  if (!screen) return "";
  const registration = contract.authentication.mode === "sign-up";
  return `<section class="concept-auth-surface" data-foundry-screen="${escapeHtml(screen.id)}" data-foundry-screen-kind="authentication">
    <div class="concept-auth-brand"><i></i><b>${escapeHtml(contract.productName)}</b></div>
    <div class="concept-auth-copy"><small>${escapeHtml(screen.eyebrow)}</small><h1>${escapeHtml(contract.authentication.title)}</h1><p>${escapeHtml(screen.summary)}</p></div>
    <form class="concept-auth-form">
      ${registration ? '<label>Full name<input type="text" name="name" autocomplete="name" placeholder="Your name" required></label>' : ""}
      <label>${escapeHtml(contract.authentication.identityLabel)}<input type="email" name="email" autocomplete="username" placeholder="name@company.com" required></label>
      <label>${escapeHtml(contract.authentication.secretLabel)}<input type="password" name="password" autocomplete="current-password" placeholder="Enter your password" required></label>
      <div><label class="concept-auth-check"><input type="checkbox"> ${registration ? "I agree to the terms" : "Keep me signed in"}</label><a>${escapeHtml(contract.authentication.secondaryAction)}</a></div>
      <button type="submit">${escapeHtml(screen.primaryAction)} <i>→</i></button>
      <p class="concept-auth-state"><i></i> Secure access · Clear recovery</p>
    </form>
  </section>`;
}

function markup(contract) {
  const spec = contract.productRenderSpec;
  if (!spec?.screens?.length) return legacyMarkup(contract);
  const authScreen = spec.screens.find((screen) => screen.kind === "authentication");
  const productScreens = spec.screens.filter((screen) => screen.kind !== "authentication");
  const visibleScreens = productScreens.length > 0 ? productScreens : spec.screens;
  return `<main class="${authScreen ? `concept-journey concept-journey-${escapeHtml(contract.family)} concept-journey-${escapeHtml(contract.primitive)} ` : ""}concept-product concept-${escapeHtml(contract.primitive)}" data-foundry-render-spec="${escapeHtml(spec.renderSpecId)}">
    <header class="concept-nav ${contract.family === "gallery" ? "concept-nav-ruled" : ""} ${contract.family === "technical" ? "concept-nav-dark" : ""}">
      <b>${escapeHtml(contract.productName)}</b>
      <nav>${spec.navigation.map((item, index) => `<button type="button" data-foundry-screen-target="${escapeHtml(item.screenId)}" class="${index === 0 ? "active" : ""}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item.label)}</button>`).join("")}</nav>
      <em>${escapeHtml(contract.directionName)}</em><button class="concept-global-action" type="button" data-foundry-next>${escapeHtml(contract.primaryAction)}</button>
    </header>
    <div class="concept-product-surface">
      <div class="concept-flow-rail">${spec.screens.map((screen, index) => `<button type="button" data-foundry-screen-target="${escapeHtml(screen.id)}" class="${index === 0 ? "active" : ""}"><i>${String(index + 1).padStart(2, "0")}</i><span>${escapeHtml(screen.navLabel)}</span><small>${escapeHtml(screen.kind)}</small></button>`).join("")}</div>
      <div class="concept-screen-stack">
        ${visibleScreens.map((screen, index) => `<section class="concept-screen ${index === 0 ? "active" : ""}" data-foundry-screen="${escapeHtml(screen.id)}" data-foundry-screen-kind="${escapeHtml(screen.kind)}">${screenFamilyComposition(contract, screen, index)}</section>`).join("")}
        ${authScreen ? `<div class="concept-auth-overlay active">${authenticationPanel(contract, authScreen)}</div>` : ""}
        <div class="concept-state-toast" role="status"><b>Ready</b><span>The complete product state is represented in this concept.</span></div>
      </div>
    </div>
  </main>`;
}

export function renderDesignConceptDocument(contract) {
  const c = contract;
  const scale = c.typeScale === "monumental" ? 1.3 : c.typeScale === "dramatic" ? 1.15 : c.typeScale === "editorial" ? 1 : c.typeScale === "utilitarian" ? 0.82 : 0.9;
  const beat = c.spacingRhythm === "wide-breath" ? 1.35 : c.spacingRhythm === "tight-grid" ? 0.72 : c.spacingRhythm === "irregular-accent" ? 1.12 : 1;
  const radius = c.surfaceDepth === "layered-glass" ? "16px" : c.surfaceDepth === "soft-elevation" ? "10px" : c.surfaceDepth === "immersive-void" ? "2px" : "0px";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--bg:${c.colors.background};--surface:${c.colors.surface};--primary:${c.colors.primary};--accent:${c.colors.accent};--text:${c.colors.text};--scale:${scale};--beat:${beat};--radius:${radius};--font:${fontStack(c.typeVoice)}}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--font)}body{font-size:12px}a,button{font:inherit}.concept-nav{height:58px;padding:0 30px;display:flex;align-items:center;gap:28px;border-bottom:1px solid color-mix(in srgb,var(--text) 16%,transparent)}.concept-nav b{font-size:14px;letter-spacing:.02em}.concept-nav nav{display:flex;gap:18px;margin-left:auto;font:600 9px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}.concept-nav em{font:9px Arial,sans-serif;margin-left:12px}.concept-nav-ruled{border-top:5px solid var(--primary)}.concept-nav-dark{background:var(--primary);color:var(--surface)}
    h1,h2,p{margin:0}h1{font-weight:500;letter-spacing:-.045em;line-height:.92}small{font:600 9px/1.2 Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase}.concept-journey{display:grid;grid-template-columns:290px minmax(0,1fr);min-height:560px;background:var(--bg)}.concept-auth-surface{padding:26px 24px;background:var(--surface);border-right:1px solid color-mix(in srgb,var(--text) 15%,transparent);display:flex;flex-direction:column}.concept-auth-brand{display:flex;align-items:center;gap:9px;font-size:11px}.concept-auth-brand>i{width:18px;height:18px;border-radius:5px;background:var(--primary);box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--accent) 65%,transparent)}.concept-auth-copy{margin:auto 0 22px}.concept-auth-copy h1{font-size:calc(31px * var(--scale));margin:9px 0 11px}.concept-auth-copy p{font-size:10px;line-height:1.5;opacity:.65}.concept-auth-form{display:flex;flex-direction:column;gap:11px}.concept-auth-form>label{display:flex;flex-direction:column;gap:6px;font:600 8px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase}.concept-auth-form input[type=text],.concept-auth-form input[type=email],.concept-auth-form input[type=password]{width:100%;height:37px;border:1px solid color-mix(in srgb,var(--text) 23%,transparent);border-radius:5px;background:var(--bg);color:var(--text);padding:0 10px;font:11px var(--font);outline:none}.concept-auth-form input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent)}.concept-auth-form>div{display:flex;justify-content:space-between;align-items:center;font:8px Arial,sans-serif}.concept-auth-check{display:flex;align-items:center;gap:5px}.concept-auth-check input{accent-color:var(--accent)}.concept-auth-form>div a{color:var(--accent)}.concept-auth-form>button{height:39px;border:0;border-radius:5px;background:var(--primary);color:var(--surface);font-weight:700;display:flex;align-items:center;justify-content:space-between;padding:0 12px}.concept-auth-form>button i{font-style:normal;color:var(--accent)}.concept-auth-state{font:8px Arial,sans-serif;opacity:.58;display:flex;align-items:center;gap:6px}.concept-auth-state i{width:6px;height:6px;border-radius:50%;background:var(--accent)}.concept-product-surface{min-width:0;position:relative;overflow:hidden}.concept-step-label{height:36px;padding:0 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent);background:color-mix(in srgb,var(--surface) 76%,var(--bg));font:8px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em}.concept-step-label b{color:var(--accent)}.concept-step-label span{opacity:.58}.concept-product-surface .concept-workspace,.concept-product-surface .concept-guided{min-height:524px}.concept-product-surface .concept-editorial{min-height:466px}.concept-photo{position:relative;overflow:hidden;background:radial-gradient(circle at 25% 22%,color-mix(in srgb,var(--accent) 88%,white),transparent 18%),linear-gradient(145deg,color-mix(in srgb,var(--primary) 92%,black),color-mix(in srgb,var(--accent) 68%,var(--surface)) 55%,color-mix(in srgb,var(--text) 84%,black));filter:saturate(.72)}.concept-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 20%,rgb(255 255 255/.15) 20.5%,transparent 21%),radial-gradient(ellipse at 65% 80%,rgb(0 0 0/.45),transparent 45%);mix-blend-mode:overlay}
    .concept-editorial{padding:18px 30px 34px}.concept-hero{display:grid;grid-template-columns:1.55fr .75fr;min-height:310px}.concept-photo-hero{min-height:310px}.concept-photo-hero span{position:absolute;z-index:2;top:14px;left:14px;color:white;font:9px Arial}.concept-hero-copy{display:flex;flex-direction:column;justify-content:flex-end;padding:24px 0 8px 26px}.concept-hero-copy h1{font-size:calc(38px * var(--scale));max-width:9ch;margin:10px 0 18px}.concept-hero-copy p{font-size:11px;line-height:1.5;opacity:.72;max-width:30ch}.concept-hero-copy a,.concept-gallery a{margin-top:20px;font:600 9px Arial;letter-spacing:.08em;text-transform:uppercase}.concept-hero-copy i{font-style:normal;color:var(--accent)}.concept-spread{display:grid;grid-template-columns:.65fr 1fr 1.35fr;gap:14px;margin-top:28px;align-items:end}.concept-spread h2{font-size:calc(22px * var(--scale));font-weight:500;line-height:1.05;margin-top:8px}.concept-photo-tall{height:155px}.concept-photo-wide{height:105px}.concept-spread p{grid-column:3;font-size:10px;opacity:.64}
    .concept-gallery{display:grid;grid-template-columns:185px 1fr;min-height:420px}.concept-gallery>aside{padding:28px 20px;border-right:1px solid color-mix(in srgb,var(--text) 15%,transparent);display:flex;flex-direction:column}.concept-gallery h1{font-size:calc(28px * var(--scale));margin:12px 0}.concept-gallery>section{padding:18px}.concept-filters{display:flex;gap:6px;margin-bottom:14px}.concept-filters span{padding:6px 9px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);font:8px Arial;text-transform:uppercase}.concept-filters .active{background:var(--primary);color:var(--surface)}.concept-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.concept-grid figure{margin:0}.concept-grid .concept-photo{height:95px}.concept-grid .tile-1{grid-column:span 2}.concept-grid .tile-1 .concept-photo{height:140px}.concept-grid .tile-4{grid-row:span 2}.concept-grid .tile-4 .concept-photo{height:155px}.concept-grid figcaption{display:flex;gap:8px;margin-top:5px;font:8px Arial}.concept-grid figcaption b{color:var(--accent)}
    .concept-workspace{display:grid;grid-template-columns:150px 1fr;min-height:440px}.concept-workspace>aside{padding:24px 16px;background:var(--primary);color:var(--surface);display:flex;flex-direction:column}.concept-workspace>aside nav{display:flex;flex-direction:column;gap:4px;margin:35px 0}.concept-workspace>aside nav span{padding:8px;border-radius:4px;font:9px Arial}.concept-workspace>aside nav .active{background:color-mix(in srgb,var(--surface) 15%,transparent)}.concept-workspace>aside small{margin-top:auto}.concept-workspace>section{padding:26px}.concept-workspace header{display:flex;justify-content:space-between;align-items:end}.concept-workspace h1{font-size:calc(30px * var(--scale));max-width:18ch;margin-top:8px}.concept-workspace button,.concept-form button,.concept-code button{border:0;background:var(--accent);color:var(--surface);padding:10px 14px}.concept-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:24px 0}.concept-metrics article{padding:14px;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);display:flex;flex-direction:column;gap:8px}.concept-metrics article i{height:3px;background:var(--accent);width:55%}.concept-table{border-top:1px solid color-mix(in srgb,var(--text) 18%,transparent)}.concept-table div{display:grid;grid-template-columns:35px 1fr auto;padding:11px 4px;border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent)}.concept-table em{font:8px Arial;color:var(--accent)}
    .concept-guided{min-height:440px;display:grid;grid-template-columns:1.15fr .85fr}.concept-guided-story{padding:32px;background:var(--primary);color:var(--surface);display:flex;flex-direction:column}.concept-guided-story small{margin-top:auto}.concept-guided-story h1{font-size:calc(34px * var(--scale));margin:12px 0 24px;max-width:14ch}.concept-guided-story ol{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;list-style:none;padding:0}.concept-guided-story li{display:flex;gap:8px;border-top:1px solid color-mix(in srgb,var(--surface) 22%,transparent);padding-top:8px;font-size:9px}.concept-guided-story li i{font-style:normal;color:var(--accent)}.concept-form{padding:38px 30px;display:flex;flex-direction:column;justify-content:center;background:var(--surface)}.concept-form h2{font-size:calc(25px * var(--scale));margin:8px 0 18px}.concept-form label{font:8px Arial;text-transform:uppercase;margin:6px 0}.concept-form label span{display:block;height:29px;border-bottom:1px solid var(--text);margin-top:4px}.concept-form button{margin-top:15px}.concept-form p{font-size:9px;opacity:.6;margin-top:12px}
    .concept-technical{display:grid;grid-template-columns:165px 1fr;min-height:405px}.concept-technical>aside{padding:24px 14px;border-right:1px solid color-mix(in srgb,var(--text) 14%,transparent);display:flex;flex-direction:column;gap:4px}.concept-technical>aside span{padding:7px;font:9px Arial}.concept-technical>aside .active{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}.concept-technical>article{padding:32px;max-width:640px}.concept-technical h1{font-size:calc(32px * var(--scale));margin:10px 0}.concept-technical p{opacity:.65}.concept-code{margin-top:24px;padding:14px;background:var(--primary);color:var(--surface);font-family:monospace}.concept-code>i{color:var(--accent);font-style:normal}.concept-code>b{margin-left:10px}.concept-code button{float:right;padding:5px 8px}.concept-code pre{margin:18px 0 0;line-height:1.6;color:color-mix(in srgb,var(--surface) 75%,transparent)}
    .concept-auth-visual{display:none;position:relative;overflow:hidden}.concept-auth-visual span{position:absolute;display:block;background:var(--accent)}
    .concept-journey-editorial{grid-template-columns:minmax(360px,1.08fr) minmax(0,.92fr)}.concept-journey-editorial .concept-auth-surface{position:relative;padding:34px;color:var(--surface);background:var(--primary);border:0}.concept-journey-editorial .concept-auth-brand>i{background:var(--accent);box-shadow:none}.concept-journey-editorial .concept-auth-visual{display:block;height:150px;margin:34px -34px 24px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 70%,var(--primary)),var(--primary))}.concept-journey-editorial .concept-auth-visual span:nth-child(1){inset:18px auto 18px 12%;width:1px;background:color-mix(in srgb,var(--surface) 45%,transparent);transform:rotate(18deg)}.concept-journey-editorial .concept-auth-visual span:nth-child(2){right:13%;bottom:0;width:42%;height:62%;background:color-mix(in srgb,var(--surface) 13%,transparent)}.concept-journey-editorial .concept-auth-visual span:nth-child(3){right:0;top:0;width:34%;height:2px}.concept-journey-editorial .concept-auth-copy{margin:0 0 18px}.concept-journey-editorial .concept-auth-copy h1{font-size:calc(42px * var(--scale));max-width:7ch}.concept-journey-editorial .concept-auth-copy p{color:color-mix(in srgb,var(--surface) 70%,transparent)}.concept-journey-editorial .concept-auth-form input[type=email],.concept-journey-editorial .concept-auth-form input[type=password]{border-color:color-mix(in srgb,var(--surface) 28%,transparent);background:transparent;color:var(--surface)}.concept-journey-editorial .concept-auth-form>button{background:var(--surface);color:var(--primary)}
    .concept-journey-technical{grid-template-columns:340px minmax(0,1fr);background:var(--primary)}.concept-journey-technical .concept-auth-surface{padding:28px;background:var(--primary);color:var(--surface);border-right:1px solid color-mix(in srgb,var(--surface) 18%,transparent)}.concept-journey-technical .concept-auth-brand{font-family:monospace}.concept-journey-technical .concept-auth-brand>i{border-radius:50%;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 25%,transparent);background:var(--accent)}.concept-journey-technical .concept-auth-visual{display:block;height:86px;margin:38px 0 20px;border:1px solid color-mix(in srgb,var(--surface) 18%,transparent);background:color-mix(in srgb,var(--surface) 5%,transparent)}.concept-journey-technical .concept-auth-visual:before{content:"> authenticate --secure";position:absolute;left:12px;top:12px;color:var(--accent);font:9px monospace}.concept-journey-technical .concept-auth-visual span:nth-child(1){left:12px;right:16%;top:36px;height:1px}.concept-journey-technical .concept-auth-visual span:nth-child(2){left:12px;right:36%;top:52px;height:1px;background:color-mix(in srgb,var(--surface) 24%,transparent)}.concept-journey-technical .concept-auth-copy{margin:0 0 18px}.concept-journey-technical .concept-auth-form input[type=email],.concept-journey-technical .concept-auth-form input[type=password]{border-radius:0;border-color:color-mix(in srgb,var(--surface) 24%,transparent);background:color-mix(in srgb,var(--surface) 6%,transparent);color:var(--surface);font-family:monospace}.concept-journey-technical .concept-auth-form>button{border-radius:0;background:var(--accent)}
    .concept-journey-guided{grid-template-columns:minmax(330px,.8fr) minmax(0,1.2fr);padding:26px;gap:26px;background:linear-gradient(135deg,var(--accent),var(--primary))}.concept-journey-guided .concept-auth-surface{padding:30px;border:0;border-radius:var(--radius);box-shadow:0 24px 60px rgb(0 0 0/.2)}.concept-journey-guided .concept-auth-visual{display:grid;height:88px;margin:28px 0 18px;grid-template-columns:repeat(3,1fr);gap:7px}.concept-journey-guided .concept-auth-visual span{position:relative;border-radius:8px;background:color-mix(in srgb,var(--accent) 18%,var(--bg))}.concept-journey-guided .concept-auth-visual span:nth-child(2){transform:translateY(14px);background:color-mix(in srgb,var(--accent) 38%,var(--bg))}.concept-journey-guided .concept-auth-copy{margin:0 0 18px}.concept-journey-guided .concept-product-surface{border-radius:var(--radius);background:var(--bg);box-shadow:0 24px 60px rgb(0 0 0/.2)}
    .concept-journey-gallery{grid-template-columns:minmax(380px,1fr) minmax(0,1fr)}.concept-journey-gallery .concept-auth-surface{padding:30px}.concept-journey-gallery .concept-auth-visual{display:block;height:170px;margin:28px 0 22px;background:linear-gradient(135deg,var(--primary),var(--accent))}.concept-journey-gallery .concept-auth-visual span:nth-child(1){inset:14px 52% 52% 14px;background:var(--surface)}.concept-journey-gallery .concept-auth-visual span:nth-child(2){inset:14px 14px 24% 52%;background:color-mix(in srgb,var(--surface) 68%,transparent)}.concept-journey-gallery .concept-auth-visual span:nth-child(3){inset:52% 52% 14px 14px;background:color-mix(in srgb,var(--surface) 35%,transparent)}.concept-journey-gallery .concept-auth-copy{margin:0 0 18px}
    body[data-foundry-primitive="immersive-hero"] .concept-hero{position:relative;display:block;min-height:420px}.concept-journey-editorial body[data-foundry-primitive="immersive-hero"] .concept-hero{min-height:360px}body[data-foundry-primitive="immersive-hero"] .concept-photo-hero{position:absolute;inset:0}body[data-foundry-primitive="immersive-hero"] .concept-hero-copy{position:absolute;z-index:2;inset:auto 0 0 0;padding:80px 28px 26px;color:white;background:linear-gradient(transparent,rgb(0 0 0/.78))}body[data-foundry-primitive="immersive-hero"] .concept-hero-copy h1{font-size:calc(48px * var(--scale));max-width:12ch}body[data-foundry-primitive="immersive-hero"] .concept-spread{display:flex;gap:18px;align-items:center}
    body[data-foundry-primitive="narrative-scroll"] .concept-editorial{padding:0}body[data-foundry-primitive="narrative-scroll"] .concept-hero{grid-template-columns:.72fr 1.28fr;min-height:260px}body[data-foundry-primitive="narrative-scroll"] .concept-hero-copy{order:-1;padding:34px}body[data-foundry-primitive="narrative-scroll"] .concept-photo-hero{min-height:260px}body[data-foundry-primitive="narrative-scroll"] .concept-spread{grid-template-columns:1fr;gap:0;margin:0}body[data-foundry-primitive="narrative-scroll"] .concept-spread>*{padding:18px 28px;border-top:1px solid color-mix(in srgb,var(--text) 15%,transparent)}body[data-foundry-primitive="narrative-scroll"] .concept-photo{height:48px}
    body[data-foundry-primitive="asymmetric-split"] .concept-hero{grid-template-columns:.82fr 1.18fr;transform:skewX(-3deg);margin-inline:18px}body[data-foundry-primitive="asymmetric-split"] .concept-hero>*{transform:skewX(3deg)}body[data-foundry-primitive="asymmetric-split"] .concept-hero-copy{order:-1;padding:35px 28px}body[data-foundry-primitive="asymmetric-split"] .concept-spread{grid-template-columns:1.25fr .7fr .9fr;margin-left:8%}
    body[data-foundry-primitive="identity-work-canvas"] .concept-hero{grid-template-columns:.55fr 1.45fr}body[data-foundry-primitive="identity-work-canvas"] .concept-hero-copy{order:-1;justify-content:flex-start;padding:28px 20px 20px 0;border-right:1px solid color-mix(in srgb,var(--text) 18%,transparent)}body[data-foundry-primitive="identity-work-canvas"] .concept-spread{grid-template-columns:.8fr 1.3fr .7fr}
    body[data-foundry-primitive="catalog"] .concept-gallery{grid-template-columns:235px 1fr}body[data-foundry-primitive="catalog"] .concept-grid{grid-template-columns:repeat(3,1fr)}body[data-foundry-primitive="catalog"] .concept-grid .concept-photo{height:118px}body[data-foundry-primitive="map-led"] .concept-gallery{grid-template-columns:1fr 255px}body[data-foundry-primitive="map-led"] .concept-gallery>aside{order:2;border:0;border-left:1px solid color-mix(in srgb,var(--text) 15%,transparent)}body[data-foundry-primitive="map-led"] .concept-grid{grid-template-columns:2fr 1fr}body[data-foundry-primitive="map-led"] .concept-grid figure:first-child{grid-row:span 3}body[data-foundry-primitive="map-led"] .concept-grid figure:first-child .concept-photo{height:320px}
    body[data-foundry-primitive="table-operations"] .concept-workspace{grid-template-columns:105px 1fr}body[data-foundry-primitive="table-operations"] .concept-metrics{display:flex;margin:14px 0}body[data-foundry-primitive="table-operations"] .concept-metrics article{padding:8px 10px;flex:1}body[data-foundry-primitive="table-operations"] .concept-table div{padding-block:8px;background:var(--surface)}body[data-foundry-primitive="timeline"] .concept-workspace,body[data-foundry-primitive="calendar"] .concept-workspace{grid-template-columns:1fr}body[data-foundry-primitive="timeline"] .concept-workspace>aside,body[data-foundry-primitive="calendar"] .concept-workspace>aside{display:flex;flex-direction:row;align-items:center;padding:12px 18px}body[data-foundry-primitive="timeline"] .concept-workspace>aside nav,body[data-foundry-primitive="calendar"] .concept-workspace>aside nav{flex-direction:row;margin:0 0 0 auto}body[data-foundry-primitive="timeline"] .concept-metrics{grid-template-columns:1fr}body[data-foundry-primitive="timeline"] .concept-metrics article{display:grid;grid-template-columns:30px 1fr 80px;align-items:center}body[data-foundry-primitive="timeline"] .concept-table{margin-left:24px;border-left:3px solid var(--accent)}body[data-foundry-primitive="calendar"] .concept-table{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;border:0}body[data-foundry-primitive="calendar"] .concept-table div{min-height:68px;border:1px solid color-mix(in srgb,var(--text) 13%,transparent);display:flex;flex-direction:column;gap:6px}body[data-foundry-primitive="conversation-surface"] .concept-workspace{grid-template-columns:205px 1fr}body[data-foundry-primitive="conversation-surface"] .concept-metrics{grid-template-columns:1fr;margin:14px 0}body[data-foundry-primitive="conversation-surface"] .concept-metrics article{width:78%;border-radius:12px}body[data-foundry-primitive="conversation-surface"] .concept-metrics article:nth-child(even){margin-left:auto;background:color-mix(in srgb,var(--accent) 10%,var(--surface))}body[data-foundry-primitive="profile-led"] .concept-workspace{grid-template-columns:1fr}body[data-foundry-primitive="profile-led"] .concept-workspace>aside{min-height:130px;display:grid;grid-template-columns:1fr auto;align-items:end;background:linear-gradient(135deg,var(--primary),var(--accent))}body[data-foundry-primitive="profile-led"] .concept-workspace>aside nav{grid-column:2;grid-row:1 / span 2;margin:0}
    body[data-foundry-primitive="mobile-stacked"] .concept-guided{grid-template-columns:300px 1fr;padding:26px;gap:24px;background:color-mix(in srgb,var(--accent) 12%,var(--bg))}body[data-foundry-primitive="mobile-stacked"] .concept-guided-story{order:2;border-radius:24px}body[data-foundry-primitive="mobile-stacked"] .concept-form{border:8px solid var(--primary);border-radius:28px;box-shadow:0 18px 34px rgb(0 0 0/.18)}
    body[data-foundry-primitive="command-surface"] .concept-technical{grid-template-columns:1fr}body[data-foundry-primitive="command-surface"] .concept-technical>aside{flex-direction:row;border:0;border-bottom:1px solid color-mix(in srgb,var(--text) 14%,transparent)}body[data-foundry-primitive="command-surface"] .concept-technical>article{max-width:none}body[data-foundry-primitive="command-surface"] .concept-code{border-left:5px solid var(--accent);box-shadow:0 18px 40px rgb(0 0 0/.18)}
    @media(max-width:520px){.concept-journey,.concept-journey-editorial,.concept-journey-technical,.concept-journey-guided,.concept-journey-gallery{grid-template-columns:1fr;padding:0;gap:0}.concept-auth-surface{min-height:520px;border-right:0;border-bottom:1px solid color-mix(in srgb,var(--text) 15%,transparent)}}
    @media(max-width:560px){.concept-nav{padding:0 16px}.concept-nav nav span:nth-child(n+3){display:none}.concept-editorial{padding:12px 16px}.concept-hero,.concept-guided{grid-template-columns:1fr}.concept-hero-copy{padding:18px 0}.concept-spread{grid-template-columns:1fr 1fr}.concept-gallery,.concept-workspace,.concept-technical{grid-template-columns:1fr}.concept-gallery>aside,.concept-workspace>aside,.concept-technical>aside{display:none}.concept-grid{grid-template-columns:repeat(2,1fr)}}
    .concept-product.concept-journey{display:block;min-height:100%;padding:0;background:var(--bg)}
    .concept-product>.concept-nav nav button{border:0;background:transparent;color:inherit;padding:7px 0;font:inherit;letter-spacing:inherit;text-transform:inherit;opacity:.52;cursor:pointer}.concept-product>.concept-nav nav button span{display:none}.concept-product>.concept-nav nav button.active{opacity:1;border-bottom:2px solid var(--accent)}
    .concept-product-surface{display:grid;grid-template-columns:126px minmax(0,1fr);height:502px;overflow:hidden}.concept-flow-rail{padding:12px 10px;background:color-mix(in srgb,var(--surface) 74%,var(--bg));border-right:1px solid color-mix(in srgb,var(--text) 12%,transparent);display:flex;flex-direction:column;gap:5px}.concept-flow-rail button{display:grid;grid-template-columns:22px 1fr;gap:1px 7px;align-items:center;padding:9px 7px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}.concept-flow-rail button i{grid-row:span 2;font:8px Arial;font-style:normal;color:var(--accent)}.concept-flow-rail button span{font:600 9px/1.15 var(--font)}.concept-flow-rail button small{font-size:6px;opacity:.5}.concept-flow-rail button.active{background:var(--primary);color:var(--surface)}
    .concept-screen-stack{position:relative;min-width:0;height:100%;overflow:hidden}.concept-screen{display:none;height:100%;overflow:auto}.concept-screen.active{display:block}.concept-screen-composition{min-height:100%}.concept-screen-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.concept-screen-head h1{font-size:calc(30px * var(--scale));margin:8px 0;max-width:18ch}.concept-screen-head p{max-width:52ch;font-size:10px;line-height:1.45;opacity:.64}.concept-screen-head>button{border:0;background:var(--accent);color:var(--surface);padding:10px 13px;white-space:nowrap}.concept-screen-head>button i{font-style:normal}
    .concept-screen .concept-workspace{display:block;padding:26px}.concept-screen .concept-workspace>section{padding:0}.concept-screen .concept-editorial{min-height:100%}.concept-screen .concept-gallery{min-height:100%}.concept-screen .concept-guided{min-height:100%}.concept-screen .concept-technical{min-height:100%}.concept-screen .concept-spread{align-items:stretch}.concept-screen .concept-spread .concept-region-card{min-height:140px}.concept-screen .concept-spread .concept-region-card:nth-child(2){transform:translateY(18px)}
    .concept-region-card{position:relative;display:grid!important;grid-template-columns:24px 1fr auto!important;gap:10px!important;padding:13px!important;background:var(--surface)!important;border:1px solid color-mix(in srgb,var(--text) 12%,transparent)!important;min-width:0}.concept-region-index{font:8px Arial;color:var(--accent)}.concept-region-card h3{margin:5px 0 8px;font-size:12px;font-weight:650}.concept-region-card ul{list-style:none;margin:0;padding:0;display:grid;gap:3px}.concept-region-card li{font-size:8px;opacity:.56;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.concept-region-signal{width:3px;height:62%;background:var(--accent);align-self:end}.concept-metrics article span{font-size:8px;opacity:.55}.concept-table .concept-region-card{border-width:0 0 1px!important}.concept-visual-word{position:absolute;inset:auto 18px 14px;z-index:2;color:white;font-size:clamp(32px,7vw,72px);font-weight:550;letter-spacing:-.06em;line-height:.8;max-width:8ch}
    .concept-auth-overlay{display:none;position:absolute;z-index:8;inset:14px;background:color-mix(in srgb,var(--primary) 64%,transparent);backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:20px}.concept-auth-overlay.active{display:flex}.concept-auth-overlay .concept-auth-surface{width:min(370px,96%);min-height:430px;max-height:100%;padding:27px;border:0;border-radius:var(--radius);box-shadow:0 25px 70px rgb(0 0 0/.28);background:var(--surface);color:var(--text)}.concept-auth-overlay .concept-auth-copy{margin:36px 0 20px}.concept-auth-overlay .concept-auth-copy h1{font-size:calc(34px * var(--scale));max-width:11ch}.concept-auth-overlay .concept-auth-form input{background:var(--bg)!important;color:var(--text)!important;border-color:color-mix(in srgb,var(--text) 22%,transparent)!important}.concept-auth-overlay .concept-auth-form>button{background:var(--primary)!important;color:var(--surface)!important}
    .concept-journey-asymmetric-split .concept-auth-overlay{inset:0;padding:0;justify-content:flex-end;background:linear-gradient(118deg,color-mix(in srgb,var(--accent) 42%,var(--primary)) 0 49%,transparent 49.2%),linear-gradient(90deg,var(--primary),color-mix(in srgb,var(--primary) 60%,transparent));backdrop-filter:none}.concept-journey-asymmetric-split .concept-auth-overlay .concept-auth-surface{width:52%;min-height:100%;border-radius:0;padding:34px 34px 28px;box-shadow:-28px 0 70px rgb(0 0 0/.22)}.concept-journey-asymmetric-split .concept-auth-copy{margin:18px 0 auto}.concept-journey-asymmetric-split .concept-auth-copy h1{font-size:calc(42px * var(--scale));max-width:8ch}
    .concept-journey-immersive-hero .concept-auth-overlay{inset:0;padding:0;align-items:flex-end;justify-content:flex-start;background:linear-gradient(0deg,var(--primary),transparent 76%);backdrop-filter:none}.concept-journey-immersive-hero .concept-auth-overlay .concept-auth-surface{width:76%;min-height:0;display:grid;grid-template-columns:minmax(135px,.65fr) minmax(250px,1.35fr);column-gap:24px;padding:22px 26px;border-radius:0 18px 0 0;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:22px -22px 70px rgb(0 0 0/.28)}.concept-journey-immersive-hero .concept-auth-brand{grid-column:1}.concept-journey-immersive-hero .concept-auth-copy{grid-column:1;margin:24px 0 0}.concept-journey-immersive-hero .concept-auth-form{grid-column:2;grid-row:1 / span 2;gap:6px}.concept-journey-immersive-hero .concept-auth-form input[type=text],.concept-journey-immersive-hero .concept-auth-form input[type=email],.concept-journey-immersive-hero .concept-auth-form input[type=password]{height:31px}.concept-journey-immersive-hero .concept-auth-form>button{height:33px}.concept-journey-immersive-hero .concept-auth-state{display:none}.concept-journey-immersive-hero .concept-auth-copy h1{font-size:calc(32px * var(--scale));max-width:7ch}
    .concept-journey-task-workspace .concept-auth-overlay{inset:0;padding:0;justify-content:flex-start;background:color-mix(in srgb,var(--primary) 38%,transparent)}.concept-journey-task-workspace .concept-auth-overlay .concept-auth-surface{width:42%;min-height:100%;border-radius:0;border-right:4px solid var(--accent)}
    .concept-journey-technical .concept-auth-overlay .concept-auth-surface{border:1px solid color-mix(in srgb,var(--accent) 62%,transparent);border-radius:0;background:var(--primary);color:var(--surface);font-family:monospace}.concept-journey-technical .concept-auth-overlay .concept-auth-form input{border-radius:0!important;background:color-mix(in srgb,var(--surface) 7%,transparent)!important;color:var(--surface)!important}.concept-journey-technical .concept-auth-overlay .concept-auth-form>button{border-radius:0;background:var(--accent)!important}
    .concept-state-toast{position:absolute;z-index:7;right:12px;bottom:12px;display:none;width:220px;padding:11px;border-left:3px solid var(--accent);background:var(--primary);color:var(--surface);box-shadow:0 12px 30px rgb(0 0 0/.22)}.concept-state-toast.active{display:grid;gap:3px}.concept-state-toast span{font-size:8px;opacity:.7}.concept-filters button{padding:6px 9px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);background:transparent;color:inherit;font:8px Arial;text-transform:uppercase}.concept-filters button.active{background:var(--primary);color:var(--surface)}.concept-technical>aside button{padding:7px;border:0;background:transparent;color:inherit;text-align:left;font:9px Arial}.concept-code pre{white-space:pre-wrap}
    @media(max-width:760px){.concept-product>.concept-nav nav,.concept-product>.concept-nav .concept-global-action{display:none}.concept-product>.concept-nav{justify-content:space-between}.concept-product>.concept-nav em{margin-left:auto;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.concept-flow-rail button span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.concept-flow-rail button{min-height:58px}}
    @media(max-width:560px){.concept-product-surface{grid-template-columns:1fr;height:auto;min-height:502px}.concept-flow-rail{position:relative;z-index:4;flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent)}.concept-flow-rail button{min-width:112px;max-width:112px}.concept-screen-stack{min-height:455px}.concept-screen-head{align-items:flex-start;flex-direction:column}.concept-screen-head h1{font-size:25px}.concept-auth-overlay,.concept-journey-asymmetric-split .concept-auth-overlay,.concept-journey-immersive-hero .concept-auth-overlay,.concept-journey-task-workspace .concept-auth-overlay{inset:8px;padding:12px;align-items:center;justify-content:center;background:color-mix(in srgb,var(--primary) 64%,transparent);backdrop-filter:blur(8px)}.concept-auth-overlay .concept-auth-surface,.concept-journey-asymmetric-split .concept-auth-overlay .concept-auth-surface,.concept-journey-immersive-hero .concept-auth-overlay .concept-auth-surface,.concept-journey-task-workspace .concept-auth-overlay .concept-auth-surface{display:flex;width:min(370px,96%);min-height:410px;border-radius:var(--radius);padding:24px}.concept-journey-immersive-hero .concept-auth-brand,.concept-journey-immersive-hero .concept-auth-copy,.concept-journey-immersive-hero .concept-auth-form{grid-column:auto;grid-row:auto}.concept-screen .concept-spread{grid-template-columns:1fr}.concept-product>.concept-nav em{display:none}}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style></head><body class="concept-${escapeHtml(c.primitive)}" data-foundry-render-contract="${escapeHtml(c.renderContractId)}" data-foundry-render-spec="${escapeHtml(c.productRenderSpec?.renderSpecId ?? "")}" data-foundry-primitive="${escapeHtml(c.primitive)}">${markup(c)}<script>
    (()=>{const transitions=${JSON.stringify(c.productRenderSpec?.transitions ?? []).replaceAll("<", "\\u003c")};const screens=[...document.querySelectorAll('.concept-screen')];const overlay=document.querySelector('.concept-auth-overlay');const toast=document.querySelector('.concept-state-toast');let active=screens[0]?.dataset.foundryScreen??null;function activate(id){const target=screens.find((screen)=>screen.dataset.foundryScreen===id);document.querySelectorAll('[data-foundry-screen-target]').forEach((button)=>button.classList.toggle('active',button.dataset.foundryScreenTarget===id));if(!target){if(overlay)overlay.classList.add('active');return}active=id;screens.forEach((screen)=>screen.classList.toggle('active',screen===target));if(overlay)overlay.classList.remove('active');document.body.dataset.foundryActiveScreen=id}document.querySelectorAll('[data-foundry-screen-target]').forEach((button)=>button.addEventListener('click',()=>activate(button.dataset.foundryScreenTarget)));document.querySelectorAll('[data-foundry-next]').forEach((button)=>button.addEventListener('click',()=>{const transition=transitions.find((item)=>item.from===active);if(transition)activate(transition.to)}));document.querySelector('.concept-auth-form')?.addEventListener('submit',(event)=>{event.preventDefault();const next=transitions.find((item)=>item.from===event.currentTarget.closest('[data-foundry-screen]')?.dataset.foundryScreen);activate(next?.to??screens[0]?.dataset.foundryScreen)});document.querySelectorAll('[data-foundry-state]').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('[data-foundry-state]').forEach((item)=>item.classList.toggle('active',item===button));if(toast){toast.querySelector('b').textContent=button.dataset.foundryState;toast.querySelector('span').textContent='This concept includes the '+button.dataset.foundryState+' product state.';toast.classList.add('active');setTimeout(()=>toast.classList.remove('active'),1800)}}))})();
  </script></body></html>`;
}
