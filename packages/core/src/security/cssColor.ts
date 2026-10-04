/**
 * COL2: the closed colour grammar a peer colour (or any other untrusted value
 * written into a CSS colour slot) must match. It is deliberately smaller than
 * CSS: a hex colour, a named colour from a fixed list, or `rgb`/`rgba`/`hsl`/
 * `hsla` whose single argument list holds only digits, `.`, `-`, `%`, `,`,
 * `/`, spaces, and the `deg` unit. Nothing else can appear, so no `url(`,
 * `image-set(`, `var(`, `expression(`, comment, escape, `;`, or `}` survives.
 */

/** Longer than any colour this grammar admits with sane spacing. */
const CSS_COLOR_MAX_LENGTH = 64;

const HEX_COLOR_PATTERN =
	/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const FUNCTION_COLOR_PATTERN = /^(?:rgba?|hsla?)\((?:[0-9.,%/ -]|deg)+\)$/i;

/** CSS Color 4 named colours, plus `transparent` and `currentcolor`. */
const CSS_NAMED_COLORS: ReadonlySet<string> = new Set([
	"transparent",
	"currentcolor",
	"aliceblue",
	"antiquewhite",
	"aqua",
	"aquamarine",
	"azure",
	"beige",
	"bisque",
	"black",
	"blanchedalmond",
	"blue",
	"blueviolet",
	"brown",
	"burlywood",
	"cadetblue",
	"chartreuse",
	"chocolate",
	"coral",
	"cornflowerblue",
	"cornsilk",
	"crimson",
	"cyan",
	"darkblue",
	"darkcyan",
	"darkgoldenrod",
	"darkgray",
	"darkgreen",
	"darkgrey",
	"darkkhaki",
	"darkmagenta",
	"darkolivegreen",
	"darkorange",
	"darkorchid",
	"darkred",
	"darksalmon",
	"darkseagreen",
	"darkslateblue",
	"darkslategray",
	"darkslategrey",
	"darkturquoise",
	"darkviolet",
	"deeppink",
	"deepskyblue",
	"dimgray",
	"dimgrey",
	"dodgerblue",
	"firebrick",
	"floralwhite",
	"forestgreen",
	"fuchsia",
	"gainsboro",
	"ghostwhite",
	"gold",
	"goldenrod",
	"gray",
	"green",
	"greenyellow",
	"grey",
	"honeydew",
	"hotpink",
	"indianred",
	"indigo",
	"ivory",
	"khaki",
	"lavender",
	"lavenderblush",
	"lawngreen",
	"lemonchiffon",
	"lightblue",
	"lightcoral",
	"lightcyan",
	"lightgoldenrodyellow",
	"lightgray",
	"lightgreen",
	"lightgrey",
	"lightpink",
	"lightsalmon",
	"lightseagreen",
	"lightskyblue",
	"lightslategray",
	"lightslategrey",
	"lightsteelblue",
	"lightyellow",
	"lime",
	"limegreen",
	"linen",
	"magenta",
	"maroon",
	"mediumaquamarine",
	"mediumblue",
	"mediumorchid",
	"mediumpurple",
	"mediumseagreen",
	"mediumslateblue",
	"mediumspringgreen",
	"mediumturquoise",
	"mediumvioletred",
	"midnightblue",
	"mintcream",
	"mistyrose",
	"moccasin",
	"navajowhite",
	"navy",
	"oldlace",
	"olive",
	"olivedrab",
	"orange",
	"orangered",
	"orchid",
	"palegoldenrod",
	"palegreen",
	"paleturquoise",
	"palevioletred",
	"papayawhip",
	"peachpuff",
	"peru",
	"pink",
	"plum",
	"powderblue",
	"purple",
	"rebeccapurple",
	"red",
	"rosybrown",
	"royalblue",
	"saddlebrown",
	"salmon",
	"sandybrown",
	"seagreen",
	"seashell",
	"sienna",
	"silver",
	"skyblue",
	"slateblue",
	"slategray",
	"slategrey",
	"snow",
	"springgreen",
	"steelblue",
	"tan",
	"teal",
	"thistle",
	"tomato",
	"turquoise",
	"violet",
	"wheat",
	"white",
	"whitesmoke",
	"yellow",
	"yellowgreen",
]);

/**
 * Whether `value` is a plain CSS colour safe to write into a colour slot
 * (COL2). The value is tested as given — callers trim first if they accept
 * surrounding whitespace.
 *
 * @param value - An untrusted value.
 * @returns `true` only for a hex colour, a named colour, or an `rgb`/`hsl`
 * function made of numbers and separators.
 */
export function isSafeCssColor(value: unknown): value is string {
	if (typeof value !== "string" || value.length > CSS_COLOR_MAX_LENGTH) {
		return false;
	}
	return (
		HEX_COLOR_PATTERN.test(value) ||
		FUNCTION_COLOR_PATTERN.test(value) ||
		CSS_NAMED_COLORS.has(value.toLowerCase())
	);
}
