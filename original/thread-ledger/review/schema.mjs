// The subset of JSON Schema the findings contract uses (skills#225):
// type, required, properties, additionalProperties false, items, enum,
// pattern, minLength, minimum and maximum. The skills run with no
// dependencies, so no general validator is loaded.

/** @typedef {{ type?: string, description?: string, required?: string[], properties?: Record<string, Schema>, additionalProperties?: boolean, items?: Schema, enum?: unknown[], pattern?: string, minLength?: number, minimum?: number, maximum?: number }} Schema */

/** @type {Record<string, string>} */
const ARTICLE = { object: "an ", array: "an ", integer: "an ", string: "a ", number: "a " };

/**
 * @param {unknown} value
 * @param {string} type
 */
function hasType(value, type) {
  if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/**
 * Every way `value` departs from `schema`, one line each, naming the path.
 * @param {Schema} schema
 * @param {unknown} value
 * @param {string} [at]
 * @returns {string[]}
 */
export function schemaProblems(schema, value, at = "") {
  const name = at || "the file";
  const want = `\`${name}\` must be ${schema.description ?? schema.type}`;
  if (schema.type && !hasType(value, schema.type)) {
    return [`\`${name}\` must be ${ARTICLE[schema.type] ?? ""}${schema.type}: ${schema.description ?? ""}`];
  }
  if (schema.enum && !schema.enum.includes(value)) return [want];
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return [want];
    if (schema.minLength !== undefined && value.length < schema.minLength) return [want];
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return [want];
    if (schema.maximum !== undefined && value > schema.maximum) return [want];
  }
  /** @type {string[]} */
  const out = [];
  if (Array.isArray(value) && schema.items) {
    const items = schema.items;
    value.forEach((v, i) => out.push(...schemaProblems(items, v, `${at}[${i}]`)));
  }
  if (hasType(value, "object") && schema.properties) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const props = schema.properties;
    const dot = at ? `${at}.` : "";
    for (const key of schema.required ?? []) {
      if (!(key in obj)) out.push(`\`${dot}${key}\` is missing: ${props[key]?.description ?? key}`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const prop = props[key];
      if (prop) out.push(...schemaProblems(prop, v, `${dot}${key}`));
      else if (schema.additionalProperties === false) out.push(`\`${dot}${key}\` is not a field of the contract`);
    }
  }
  return out;
}
