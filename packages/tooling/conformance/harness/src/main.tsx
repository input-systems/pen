// Must load before react-dom: the render probe installs the DevTools hook.
import "./probes/reactHook";
import "./probes/index";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getHarnessSession } from "./session";
import { mountStaticHost } from "./staticHost";
import { mountVanillaHost } from "./vanillaHost";
import { mountVueHost } from "./vueHost";

const query = new URLSearchParams(window.location.search);
if (query.get("unstyled") !== "1") {
	await import("./styles.css");
}

getHarnessSession();

const root = document.getElementById("root");
if (!root) {
	throw new Error("conformance harness: #root is missing");
}

/**
 * `?surface=react|vue|vanilla|static` (default `react`). Every surface reads
 * the same harness session and renders the same `[data-fixture]` marker, so
 * scenarios load fixtures the same way on each.
 */
const SURFACES = new Map<string, (target: HTMLElement) => void>([
	["react", (target) => createRoot(target).render(<App />)],
	["vue", mountVueHost],
	["vanilla", mountVanillaHost],
	["static", mountStaticHost],
]);
const surface = query.get("surface") ?? "react";
const mount = SURFACES.get(surface);
if (typeof mount !== "function") {
	throw new Error(`conformance harness: unknown surface "${surface}"`);
}
mount(root);
