import { addDistinct, bump, PROBE_ENABLED } from "./counters";

/**
 * P3: a minimal React DevTools global hook, installed before react-dom loads
 * (this module is main.tsx's first import). On each commit it walks only the
 * subtrees React actually processed and counts tracked components that
 * performed work, so a bailed-out block is not counted (SCALE6).
 */
const PERFORMED_WORK = 1;
const TRACKED = new Set([
	"EditorBlock",
	"InlineContent",
	"TableCellContent",
	"InlineAtomPortalLayer",
]);
const CONTENT = "EditorContent";

type Fiber = {
	type: unknown;
	flags: number;
	alternate: Fiber | null;
	child: Fiber | null;
	sibling: Fiber | null;
	memoizedProps: { blockId?: unknown } | null;
};

type NamedType = { name?: string; displayName?: string; type?: unknown; render?: unknown };

function ownName(type: unknown): string | undefined {
	const named = type as NamedType;
	return named.displayName ?? (typeof type === "function" ? named.name : undefined);
}

/** Resolves a component name through memo / forwardRef wrappers. */
function nameOf(type: unknown): string | undefined {
	if (type == null) return undefined;
	const named = type as NamedType;
	return ownName(type) ?? nameOf(named.type) ?? nameOf(named.render);
}

function didRender(fiber: Fiber): boolean {
	return fiber.alternate === null || (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK;
}

const COUNTERS: Readonly<Record<string, (fiber: Fiber) => void>> = Object.fromEntries([
	[CONTENT, () => bump("render.contentRenders")],
	...[...TRACKED].map((name) => [name, countBlockRender] as const),
]);

function countBlockRender(fiber: Fiber): void {
	bump("render.blockRenders");
	const blockId = fiber.memoizedProps?.blockId;
	if (typeof blockId === "string") addDistinct("render.blocksRendered", blockId);
}

function countFiber(fiber: Fiber): void {
	const counter = COUNTERS[nameOf(fiber.type) ?? ""];
	if (counter && didRender(fiber)) counter(fiber);
}

/** An untouched subtree keeps its previous child pointer; skip it. */
function processedChildren(fiber: Fiber): boolean {
	return fiber.alternate === null || fiber.child !== fiber.alternate.child;
}

function pushNext(stack: Fiber[], fiber: Fiber): void {
	if (fiber.sibling) stack.push(fiber.sibling);
	if (fiber.child && processedChildren(fiber)) stack.push(fiber.child);
}

function walk(root: Fiber): void {
	const stack: Fiber[] = [root];
	for (let fiber = stack.pop(); fiber; fiber = stack.pop()) {
		countFiber(fiber);
		pushNext(stack, fiber);
	}
}

if (PROBE_ENABLED) {
	let rendererId = 0;
	(window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
		supportsFiber: true,
		renderers: new Map(),
		inject: () => (rendererId += 1),
		onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
			bump("render.reactCommits");
			if (root.current.child) walk(root.current.child);
		},
		onCommitFiberUnmount: () => {},
		onPostCommitFiberRoot: () => {},
		checkDCE: () => {},
		setStrictMode: () => {},
	};
}
