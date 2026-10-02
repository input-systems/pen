import { envelopeGateP50Ms } from "../constants/scale1";
import type { EnvelopeRecord } from "../envelope/compare";

/** Rewrites one rung as gated at `attributedP50Ms` under the record's formula. */
export function withGatedRung(
	record: EnvelopeRecord,
	id: string,
	attributedP50Ms: number,
): EnvelopeRecord {
	return {
		...record,
		points: record.points.map((point) =>
			point.id === id
				? {
						...point,
						measuredP50Ms: attributedP50Ms + point.floorP50Ms,
						attributedP50Ms,
						gated: true,
						gateP50Ms: envelopeGateP50Ms(attributedP50Ms),
					}
				: point,
		),
	};
}
