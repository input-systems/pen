/*
 * Icons, copied from Input's set.
 *
 * These are the real paths, not lookalikes: a 14x14 grid, mostly filled rather
 * than stroked, drawn in `currentColor` so a button's hover state carries the
 * glyph with it. Input keeps one file per icon and collects them into an `Icon`
 * namespace; the playground needs a handful, so they share a file and the
 * namespace stays.
 *
 * The check draws its stroke in Input through framer-motion; here that is CSS
 * in `ui.css`, so the playground keeps the motion without the dependency.
 */

interface IconProps {
	size?: number;
	color?: string;
}

const Bold = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 2 1.75 C 2 1.336 2.336 1 2.75 1 L 7.63 1 C 8.498 1 9.221 1.137 9.799 1.41 C 10.376 1.68 10.808 2.05 11.094 2.522 C 11.384 2.989 11.531 3.518 11.531 4.109 C 11.531 4.597 11.436 5.016 11.247 5.365 C 11.065 5.702 10.804 5.989 10.487 6.203 C 10.161 6.42 9.799 6.578 9.418 6.67 L 9.418 6.79 C 9.85 6.807 10.263 6.936 10.657 7.177 C 11.05 7.413 11.371 7.747 11.62 8.176 C 11.873 8.606 12 9.123 12 9.73 C 12 10.353 11.849 10.911 11.547 11.405 C 11.245 11.894 10.789 12.283 10.179 12.573 C 9.575 12.858 8.811 13 7.889 13 L 2.75 13 C 2.336 13 2 12.664 2 12.25 L 2 11.5 C 2 11.5 2.224 11.5 2.5 11.5 C 2.776 11.5 3 11.276 3 11 L 3 3 C 3 2.724 2.776 2.5 2.5 2.5 C 2.224 2.5 2 2.5 2 2.5 Z M 5.185 11.188 L 7.54 11.188 C 8.328 11.188 8.897 11.035 9.248 10.728 C 9.604 10.423 9.782 10.034 9.782 9.561 C 9.782 9.201 9.693 8.879 9.515 8.595 C 9.334 8.302 9.073 8.068 8.763 7.918 C 8.439 7.752 8.053 7.668 7.605 7.668 L 5.185 7.668 Z M 5.185 6.106 L 7.355 6.106 C 7.732 6.106 8.069 6.036 8.366 5.896 C 8.668 5.757 8.906 5.561 9.078 5.309 C 9.259 5.041 9.353 4.723 9.345 4.399 C 9.345 3.937 9.181 3.556 8.852 3.255 C 8.528 2.949 8.045 2.796 7.402 2.796 L 5.186 2.796 L 5.186 6.106 Z"
			fill={color}
		/>
	</svg>
);

const Italic = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 5 1.5 C 5 1.224 5.224 1 5.5 1 L 11.5 1 C 11.776 1 12 1.224 12 1.5 L 12 2 C 12 2.276 11.776 2.5 11.5 2.5 L 9.386 2.5 C 9.161 2.5 8.963 2.651 8.904 2.868 L 6.722 10.868 C 6.681 11.019 6.712 11.18 6.807 11.304 C 6.902 11.428 7.049 11.5 7.205 11.5 L 8.5 11.5 C 8.776 11.5 9 11.724 9 12 L 9 12.5 C 9 12.776 8.776 13 8.5 13 L 2.5 13 C 2.224 13 2 12.776 2 12.5 L 2 12 C 2 11.724 2.224 11.5 2.5 11.5 L 4.613 11.5 C 4.839 11.5 5.036 11.35 5.096 11.132 L 7.278 3.132 C 7.319 2.981 7.288 2.82 7.193 2.696 C 7.098 2.572 6.951 2.5 6.795 2.5 L 5.5 2.5 C 5.224 2.5 5 2.276 5 2 Z"
			fill={color}
		/>
	</svg>
);

const Underline = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 7 9.446 C 7.699 9.446 8.26 9.222 8.683 8.775 C 9.107 8.326 9.318 7.709 9.318 6.922 L 9.318 1.5 C 9.318 1.224 9.542 1 9.818 1 L 10.5 1 C 10.776 1 11 1.224 11 1.5 L 11 7.166 C 11 7.916 10.841 8.581 10.522 9.158 C 10.205 9.733 9.728 10.204 9.148 10.512 C 8.552 10.837 7.835 11 7 11 C 6.169 11 5.454 10.837 4.855 10.512 C 4.274 10.205 3.796 9.734 3.479 9.158 C 3.159 8.58 3 7.916 3 7.166 L 3 1.5 C 3 1.224 3.224 1 3.5 1 L 4.182 1 C 4.458 1 4.682 1.224 4.682 1.5 L 4.682 6.921 C 4.682 7.712 4.894 8.33 5.317 8.776 C 5.74 9.223 6.301 9.446 7 9.446 Z M 3 13 C 3 12.724 3.224 12.5 3.5 12.5 L 10.5 12.5 C 10.776 12.5 11 12.724 11 13 L 11 13.5 C 11 13.776 10.776 14 10.5 14 L 3.5 14 C 3.224 14 3 13.776 3 13.5 Z"
			fill={color}
		/>
	</svg>
);

const Strikethrough = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 2.507 11.28 C 2.251 10.848 2.082 10.37 2.007 9.873 C 1.983 9.733 2.021 9.589 2.112 9.48 C 2.203 9.371 2.337 9.307 2.479 9.305 L 3.124 9.305 C 3.386 9.305 3.597 9.525 3.669 9.797 C 3.729 10.031 3.832 10.253 3.973 10.449 C 4.193 10.746 4.489 10.978 4.83 11.119 C 5.183 11.265 5.571 11.339 5.992 11.339 C 6.452 11.339 6.863 11.255 7.226 11.085 C 7.572 10.93 7.868 10.684 8.083 10.373 C 8.291 10.062 8.395 9.701 8.395 9.288 C 8.395 8.915 8.303 8.61 8.119 8.373 C 8.012 8.234 7.882 8.11 7.732 8 L 9.774 8 C 9.925 8.372 10 8.81 10 9.314 C 10 10.02 9.843 10.652 9.528 11.212 C 9.208 11.771 8.734 12.227 8.163 12.525 C 7.568 12.842 6.846 13 5.999 13 C 5.191 13 4.489 12.853 3.893 12.56 C 3.303 12.26 2.841 11.833 2.507 11.28 Z M 7.558 6 L 3.254 6 C 3.166 5.922 3.081 5.84 3 5.754 C 2.502 5.212 2.252 4.503 2.252 3.627 C 2.252 2.898 2.419 2.263 2.753 1.72 C 3.083 1.182 3.556 0.745 4.118 0.458 C 4.7 0.153 5.35 0 6.072 0 C 6.808 0 7.456 0.153 8.018 0.458 C 8.564 0.743 9.023 1.171 9.347 1.695 C 9.579 2.068 9.732 2.48 9.805 2.932 C 9.828 3.069 9.79 3.209 9.7 3.315 C 9.611 3.421 9.479 3.483 9.34 3.483 L 8.724 3.483 C 8.467 3.483 8.259 3.27 8.177 3.008 C 8.071 2.66 7.861 2.353 7.575 2.128 C 7.173 1.805 6.662 1.644 6.043 1.644 C 5.603 1.644 5.217 1.726 4.888 1.89 C 4.579 2.035 4.318 2.263 4.133 2.55 C 3.956 2.844 3.865 3.182 3.872 3.525 C 3.872 3.825 3.932 4.082 4.053 4.297 C 4.179 4.506 4.341 4.684 4.54 4.831 C 4.738 4.971 4.951 5.091 5.179 5.186 C 5.406 5.282 5.626 5.364 5.839 5.432 L 6.885 5.762 C 7.105 5.828 7.329 5.907 7.558 6 Z M 0 6 C 0 5.724 0.224 5.5 0.5 5.5 L 11.5 5.5 C 11.776 5.5 12 5.724 12 6 L 12 6.5 C 12 6.776 11.776 7 11.5 7 L 0.5 7 C 0.224 7 0 6.776 0 6.5 Z"
			fill={color}
		/>
	</svg>
);

const Code = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 4.5 2.5 L 1 7 L 4.5 11.5"
			fill="transparent"
			strokeWidth="1.5"
			stroke={color}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M 9.5 2.5 L 13 7 L 9.5 11.5"
			fill="transparent"
			strokeWidth="1.5"
			stroke={color}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const Undo = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 4.146 -1.146 C 4.461 -1.461 5 -1.238 5 -0.793 L 5 2 L 8 2 L 8 4 L 5 4 L 5 6.793 C 5 7.238 4.461 7.461 4.146 7.146 L 0.354 3.354 C 0.158 3.158 0.158 2.842 0.354 2.646 Z M 14 8 C 14 11.314 11.314 14 8 14 L 8 12 C 10.209 12 12 10.209 12 8 C 12 5.791 10.209 4 8 4 L 8 2 C 11.314 2 14 4.686 14 8 Z M 3 12 L 8 12 L 8 14 L 3 14 C 2.448 14 2 13.552 2 13 C 2 12.448 2.448 12 3 12 Z"
			fill={color}
		/>
	</svg>
);

/** The undo path, mirrored — the same trick Input uses. */
const Redo = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 14 14"
		style={{ transform: "scaleX(-1)" }}
		aria-hidden="true"
	>
		<path
			d="M 4.146 -1.146 C 4.461 -1.461 5 -1.238 5 -0.793 L 5 2 L 8 2 L 8 4 L 5 4 L 5 6.793 C 5 7.238 4.461 7.461 4.146 7.146 L 0.354 3.354 C 0.158 3.158 0.158 2.842 0.354 2.646 Z M 14 8 C 14 11.314 11.314 14 8 14 L 8 12 C 10.209 12 12 10.209 12 8 C 12 5.791 10.209 4 8 4 L 8 2 C 11.314 2 14 4.686 14 8 Z M 3 12 L 8 12 L 8 14 L 3 14 C 2.448 14 2 13.552 2 13 C 2 12.448 2.448 12 3 12 Z"
			fill={color}
		/>
	</svg>
);

/**
 * The right-rail mark. `open` is the full sidebar; `docked` is the little card
 * Input shows when the panel is put away.
 */
const SidebarRight = ({
	size = 14,
	color = "currentColor",
	open = false,
}: IconProps & { open?: boolean }) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d={
				open
					? "M 0 3.5 C 0 1.567 1.567 0 3.5 0 L 10.5 0 C 12.433 0 14 1.567 14 3.5 L 14 10.5 C 14 12.433 12.433 14 10.5 14 L 3.5 14 C 1.567 14 0 12.433 0 10.5 Z M 1.5 10.5 C 1.5 11.605 2.395 12.5 3.5 12.5 L 7.5 12.5 L 7.5 1.5 L 3.5 1.5 C 2.395 1.5 1.5 2.395 1.5 3.5 Z M 10.5 12.5 C 11.605 12.5 12.5 11.605 12.5 10.5 L 12.5 3.5 C 12.5 2.395 11.605 1.5 10.5 1.5 L 9 1.5 L 9 12.5 Z"
					: "M 0 3.5 C 0 1.567 1.567 0 3.5 0 L 10.5 0 C 12.433 0 14 1.567 14 3.5 L 14 10.5 C 14 12.433 12.433 14 10.5 14 L 3.5 14 C 1.567 14 0 12.433 0 10.5 Z M 1.5 10.5 C 1.5 11.605 2.395 12.5 3.5 12.5 L 10.5 12.5 C 11.605 12.5 12.5 11.605 12.5 10.5 L 12.5 3.5 C 12.5 2.395 11.605 1.5 10.5 1.5 L 3.5 1.5 C 2.395 1.5 1.5 2.395 1.5 3.5 Z M 7.5 4 C 7.5 3.448 7.948 3 8.5 3 L 10 3 C 10.552 3 11 3.448 11 4 L 11 10 C 11 10.552 10.552 11 10 11 L 8.5 11 C 7.948 11 7.5 10.552 7.5 10 Z"
			}
			fill={color}
		/>
	</svg>
);

const Collaborate = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 3.55 7.978 C 3.247 8.33 2.671 8.116 2.671 7.652 L 2.671 3.975 C 2.671 3.855 2.628 3.74 2.55 3.649 L 0.122 0.826 C -0.157 0.502 0.073 0 0.501 0 L 9.322 0 C 9.749 0 9.98 0.502 9.701 0.826 Z M 10.452 6.022 C 10.754 5.67 11.331 5.884 11.331 6.348 L 11.331 10.025 C 11.331 10.145 11.374 10.26 11.452 10.351 L 13.88 13.174 C 14.158 13.498 13.928 14 13.5 14 L 4.68 14 C 4.252 14 4.022 13.498 4.3 13.174 Z"
			fill={color}
		/>
	</svg>
);

const Close = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 9.828 3.111 C 10.121 2.818 10.596 2.818 10.889 3.111 C 11.182 3.404 11.182 3.879 10.889 4.172 L 8.061 7 L 10.889 9.828 C 11.182 10.121 11.182 10.596 10.889 10.889 C 10.596 11.182 10.121 11.182 9.828 10.889 L 7 8.061 L 4.172 10.889 C 3.879 11.182 3.404 11.182 3.111 10.889 C 2.818 10.596 2.818 10.121 3.111 9.828 L 5.939 7 L 3.111 4.172 C 2.818 3.879 2.818 3.404 3.111 3.111 C 3.404 2.818 3.879 2.818 4.172 3.111 L 7 5.939 Z"
			fill={color}
		/>
	</svg>
);

const ArrowUp = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 12 6 L 7 1 L 2 6 M 7 2 L 7 12"
			fill="transparent"
			strokeWidth="2"
			stroke={color}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const Stop = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 3 5 C 3 3.895 3.895 3 5 3 L 9 3 C 10.105 3 11 3.895 11 5 L 11 9 C 11 10.105 10.105 11 9 11 L 5 11 C 3.895 11 3 10.105 3 9 Z"
			fill={color}
		/>
	</svg>
);

/** The 10px chevron Input's select trigger uses. */
const ChevronSmall = ({ size = 10, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
		<path
			d="M 2 4 L 5 7 L 8 4"
			fill="transparent"
			strokeWidth="1.5"
			stroke={color}
			strokeLinecap="round"
		/>
	</svg>
);

/** The 12px check Input shows beside a selected menu row. */
const CheckSmall = ({ size = 12, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
		<path
			d="M 1.5 6 L 4.5 9 L 10.5 3"
			fill="transparent"
			strokeWidth="1.5"
			stroke={color}
			strokeLinecap="round"
		/>
	</svg>
);

/** A nib with a sparkle. Input's mark for writing something for you. */
const PenMagic = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 10.585 3.921 C 11.366 3.14 12.633 3.14 13.414 3.921 C 14.195 4.702 14.195 5.969 13.414 6.75 L 8.5 12 L 5.5 9 Z M 4.455 10.053 L 7.283 12.881 L 3.989 13.98 C 3.809 14.04 3.611 13.993 3.476 13.859 C 3.342 13.725 3.296 13.527 3.356 13.347 Z M 3.198 0.698 C 3.264 0.298 3.839 0.298 3.905 0.698 L 3.905 0.698 C 4.116 1.981 5.122 2.986 6.405 3.198 L 6.405 3.198 C 6.805 3.264 6.805 3.839 6.405 3.905 L 6.405 3.905 C 5.122 4.116 4.116 5.122 3.905 6.405 L 3.905 6.405 C 3.839 6.805 3.264 6.805 3.198 6.405 L 3.198 6.405 C 2.986 5.122 1.981 4.116 0.698 3.905 L 0.698 3.905 C 0.298 3.839 0.298 3.264 0.698 3.198 L 0.698 3.198 C 1.981 2.986 2.986 1.981 3.198 0.698 Z"
			fill={color}
		/>
	</svg>
);

/** Draws itself once, then stays. Marks a finished turn. */
const Check = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			className="icon-check-stroke"
			d="M 2.5 7 L 5.5 10 L 11.5 4"
			fill="transparent"
			strokeWidth="2"
			strokeLinecap="round"
			stroke={color}
		/>
	</svg>
);

const Plus = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 6.25 1.75 C 6.25 1.336 6.586 1 7 1 C 7.414 1 7.75 1.336 7.75 1.75 L 7.75 6.25 L 12.25 6.25 C 12.664 6.25 13 6.586 13 7 C 13 7.414 12.664 7.75 12.25 7.75 L 7.75 7.75 L 7.75 12.25 C 7.75 12.664 7.414 13 7 13 C 6.586 13 6.25 12.664 6.25 12.25 L 6.25 7.75 L 1.75 7.75 C 1.336 7.75 1 7.414 1 7 C 1 6.586 1.336 6.25 1.75 6.25 L 6.25 6.25 Z"
			fill={color}
		/>
	</svg>
);

const Anthropic = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path
			d="M 10.167 2 L 14 12 L 11.898 12 L 8.066 2 Z M 6.242 8.043 L 4.931 4.529 L 3.62 8.043 Z M 6.029 2 L 9.862 12 L 7.718 12 L 6.935 9.9 L 2.926 9.9 L 2.143 12 L 0 12 L 3.832 2 Z"
			fill={color}
		/>
	</svg>
);

/**
 * Input's mark. The product icon is animated; this is the still frame from
 * `apps/web/src/shared/ui/icons/IconLogo.tsx` (`animate="none"`).
 */
const Logo = ({ size = 14, color = "currentColor" }: IconProps) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 14 14"
		fill="none"
		style={{ overflow: "visible" }}
		aria-hidden="true"
	>
		<g transform="translate(0.909 1)">
			<path
				d="M 6.591 0 C 3.924 0.066 2.424 1.328 2.091 3.787 L 0.129 6.594 C -0.024 6.813 -0.042 7.099 0.081 7.335 C 0.204 7.572 0.449 7.721 0.716 7.721 L 1.841 7.721 C 1.979 7.721 2.091 7.833 2.091 7.971 L 2.091 9.426 C 2.091 9.978 2.539 10.426 3.091 10.426 L 4.628 10.426 C 4.911 10.426 5.171 10.586 5.298 10.84 L 5.941 12.12 L 5.941 12.12"
				fill="transparent"
				strokeWidth="1.75"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M 9.591 12.12 L 9.591 12.017 C 9.591 11.644 9.799 11.302 10.13 11.13 L 11.466 10.435 C 11.806 10.258 12.014 9.9 11.998 9.516 C 11.982 9.133 11.745 8.793 11.391 8.645 L 10.568 8.301 C 10.21 8.151 9.971 7.808 9.955 7.42 C 9.938 7.032 10.148 6.67 10.493 6.491 L 11.626 5.904 C 11.958 5.732 12.166 5.39 12.166 5.016 C 12.166 4.642 11.958 4.3 11.626 4.128 L 10.236 3.409 C 9.909 3.24 9.702 2.906 9.696 2.538 C 9.689 2.17 9.885 1.829 10.206 1.649 L 11.581 0.877 C 11.896 0.7 12.091 0.366 12.091 0.005 L 12.091 0 L 12.091 0"
				fill="transparent"
				strokeWidth="1.75"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</g>
	</svg>
);

export const Icon = {
	Anthropic,
	ArrowUp,
	Bold,
	Check,
	CheckSmall,
	ChevronSmall,
	Close,
	Collaborate,
	Code,
	Italic,
	Logo,
	PenMagic,
	Plus,
	Redo,
	SidebarRight,
	Stop,
	Strikethrough,
	Underline,
	Undo,
};
