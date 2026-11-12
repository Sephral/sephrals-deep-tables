/**
 * Pure helpers for the chance of a table row: the probability that a table formula lands in the range of a result.
 */

/** The largest number of outcomes the exact calculation keeps. */
const MAX_OUTCOMES = 20000;

/**
 * The distribution of a dice formula made of dice terms and whole numbers, for example "1d20", "2d6+3" or
 * "1d100-1". Returns null for anything else.
 * @param {string} formula
 * @returns {Map<number, number>|null}   Probability by total
 */
export function distribution(formula) {
  const text = String(formula ?? "").replace(/\s+/g, "").replace(/d%/gi, "d100");
  if ( !text || !/^[-+]?(\d*d\d+|\d+)([-+](\d*d\d+|\d+))*$/i.test(text) ) return null;
  let dist = new Map([[0, 1]]);
  for ( const match of text.matchAll(/([-+]?)(?:(\d*)d(\d+)|(\d+))/gi) ) {
    const sign = match[1] === "-" ? -1 : 1;
    if ( match[4] !== undefined ) {
      dist = new Map([...dist].map(([total, p]) => [total + (sign * Number(match[4])), p]));
      continue;
    }
    const count = Number(match[2] || 1);
    const faces = Number(match[3]);
    if ( (faces < 1) || (count < 1) || (count > 100) ) return null;
    for ( let i = 0; i < count; i++ ) {
      const next = new Map();
      for ( const [total, p] of dist ) {
        for ( let face = 1; face <= faces; face++ ) {
          const value = total + (sign * face);
          next.set(value, (next.get(value) ?? 0) + (p / faces));
        }
      }
      if ( next.size > MAX_OUTCOMES ) return null;
      dist = next;
    }
  }
  return dist;
}

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 10) / 10;
}

/**
 * The chance of every range as a percentage with one decimal. A roll outside every range is rolled again, so the
 * chances are shared among the ranges. A formula that cannot be calculated counts every value between the smallest
 * and the largest range the same.
 * @param {string} formula
 * @param {number[][]} ranges
 * @returns {number[]}
 */
export function chances(formula, ranges) {
  const dist = distribution(formula);
  if ( dist ) {
    const raw = ranges.map(([from, to]) => {
      let sum = 0;
      for ( const [total, p] of dist ) if ( (total >= from) && (total <= to) ) sum += p;
      return sum;
    });
    const all = raw.reduce((a, b) => a + b, 0);
    return raw.map(p => (all > 0 ? round(100 * p / all) : 0));
  }
  const min = Math.min(...ranges.map(r => r[0]));
  const max = Math.max(...ranges.map(r => r[1]));
  const span = (max - min) + 1;
  return ranges.map(([from, to]) => (span > 0 ? round(100 * ((to - from) + 1) / span) : 0));
}

/**
 * A percentage for display, like "12.5 %" or "25 %".
 * @param {number} value
 * @returns {string}
 */
export function formatChance(value) {
  if ( !(value > 0) ) return "0 %";
  if ( value < 0.1 ) return "<0.1 %";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} %`;
}
