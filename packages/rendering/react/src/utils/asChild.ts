import React from "react";
import { composeRefs } from "./composeRefs";

export interface AsChildProps {
	asChild?: boolean;
	children?: React.ReactNode;
}

type AsChildElementProps = Record<string, unknown>;
type AsChildElement = React.ReactElement<AsChildElementProps>;

type EventHandler = (...args: unknown[]) => unknown;

const EVENT_HANDLER_PROP = /^on[A-Z]/;

export function renderAsChild(
	props: AsChildProps & { ref?: React.Ref<HTMLElement> } & object,
	defaultTag: keyof React.JSX.IntrinsicElements,
	primitiveProps: Record<string, unknown>,
): React.ReactElement {
	const { asChild, children, ref, ...restProps } = props;
	const ownProps = mergeSlotProps(primitiveProps, restProps);

	if (asChild && React.isValidElement<AsChildElementProps>(children)) {
		const child = React.Children.only(children) as AsChildElement;
		const childRef = (child.props as { ref?: React.Ref<unknown> }).ref;
		return React.cloneElement(child, {
			...mergeSlotProps(ownProps, child.props),
			ref: composeRefs(ref, childRef),
		});
	}

	return React.createElement(defaultTag, { ...ownProps, ref }, children);
}

/**
 * Lays `outer` props over `inner` ones the way a Radix Slot does, so neither
 * side silently drops the other's behaviour: event handlers compose (the
 * outer one runs first, and a `preventDefault` there opts out of the inner
 * one, as the primitives' own composed `onClick` does), class names join,
 * styles merge with the outer winning per property, and every other prop
 * from `outer` wins. Pen's props are inner to a host's and to an `asChild`
 * child's, so an `onClick` on the child no longer replaces `onAction`, nor
 * an `onMouseDown` the AX3 press guard.
 */
function mergeSlotProps(
	inner: Record<string, unknown>,
	outer: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...inner };
	for (const [key, outerValue] of Object.entries(outer)) {
		const innerValue = inner[key];
		if (
			EVENT_HANDLER_PROP.test(key) &&
			typeof innerValue === "function" &&
			typeof outerValue === "function"
		) {
			merged[key] = composeHandlers(
				outerValue as EventHandler,
				innerValue as EventHandler,
			);
		} else if (
			key === "className" &&
			typeof innerValue === "string" &&
			typeof outerValue === "string"
		) {
			merged[key] = `${innerValue} ${outerValue}`;
		} else if (key === "style" && isStyle(innerValue) && isStyle(outerValue)) {
			merged[key] = { ...innerValue, ...outerValue };
		} else {
			merged[key] = outerValue;
		}
	}
	return merged;
}

function composeHandlers(
	outer: EventHandler,
	inner: EventHandler,
): EventHandler {
	return (...args) => {
		outer(...args);
		if (isDefaultPrevented(args[0])) {
			return;
		}
		inner(...args);
	};
}

function isDefaultPrevented(event: unknown): boolean {
	return (
		typeof event === "object" &&
		event !== null &&
		(event as { defaultPrevented?: unknown }).defaultPrevented === true
	);
}

function isStyle(value: unknown): value is React.CSSProperties {
	return typeof value === "object" && value !== null;
}
