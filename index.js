"use strict";

require("mingo/init/system");

const { randomBytes } = require("crypto");
const { EventEmitter } = require("events");
const { Aggregator, Query: MingoQuery } = require("mingo");
const { Pool } = require("pg");

const Mixed = Symbol("Mixed");
const models = Object.create(null);
let pool = null;

class ObjectId {
  constructor(value) {
    const candidate = value instanceof ObjectId
      ? value.toHexString()
      : value && typeof value.toHexString === "function"
        ? value.toHexString()
        : value == null
          ? randomBytes(12).toString("hex")
          : String(value);

    if (!ObjectId.isValid(candidate)) {
      throw new TypeError("ObjectId value must be a 24 character hexadecimal string");
    }
    this.value = candidate.toLowerCase();
  }

  static isValid(value) {
    if (value instanceof ObjectId) return true;
    return typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);
  }

  static createFromHexString(value) {
    return new ObjectId(value);
  }

  equals(value) {
    if (value instanceof ObjectId) return this.value === value.value;
    return typeof value === "string" && this.value === value.toLowerCase();
  }

  toHexString() {
    return this.value;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }
}

class Decimal128 {
  constructor(value) {
    this.value = String(value);
  }

  static fromString(value) {
    return new Decimal128(value);
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }
}

const Types = { ObjectId, Decimal128, Mixed };

function clone(value) {
  if (value === undefined) return undefined;
  return deserialize(serialize(value));
}

function serialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128) return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [key, serialize(item)]));
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function" || item === undefined) continue;
      result[key] = serialize(item);
    }
    return result;
  }
  return value;
}

function deserialize(value) {
  if (Array.isArray(value)) return value.map(deserialize);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = deserialize(item);
    return result;
  }
  return value;
}

function getPath(target, path) {
  if (!path) return target;
  return String(path).split(".").reduce((value, key) => (value == null ? undefined : value[key]), target);
}

function setPath(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function unsetPath(target, path) {
  const parts = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!cursor) return;
  }
  if (cursor) delete cursor[parts[parts.length - 1]];
}

function valuesEqual(left, right) {
  const a = serialize(left);
  const b = serialize(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

function castScalar(type, value) {
  if (value == null) return value;
  if (type === Date) return value instanceof Date ? value : new Date(value);
  if (type === ObjectId || type === Schema.Types.ObjectId) {
    if (value instanceof ObjectId) return value;
    const asString = String(value);
    return ObjectId.isValid(asString) ? new ObjectId(asString) : value;
  }
  if (type === Decimal128 || type === Schema.Types.Decimal128) {
    return value instanceof Decimal128 ? value : Decimal128.fromString(String(value));
  }
  if (type === String) return String(value);
  if (type === Number) return Number(value);
  if (type === Boolean) return Boolean(value);
  if (type === Buffer) return Buffer.isBuffer(value) ? value : Buffer.from(String(value), "base64");
  return value;
}

function isFieldConfig(value) {
  if (!value || typeof value !== "object" || value instanceof Schema || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, "type");
}

function castByDefinition(definition, value) {
  if (value == null) return value;
  if (definition instanceof Schema) return castObject(definition.definition, value);
  if (Array.isArray(definition)) {
    const itemDefinition = definition[0] || Mixed;
    return Array.isArray(value) ? value.map((item) => castByDefinition(itemDefinition, item)) : [];
  }
  if (isFieldConfig(definition)) {
    let cast = castByDefinition(definition.type, value);
    if (typeof cast === "string") {
      if (definition.trim) cast = cast.trim();
      if (definition.lowercase) cast = cast.toLowerCase();
      if (definition.uppercase) cast = cast.toUpperCase();
    }
    return cast;
  }
  if (definition === Mixed || definition === Schema.Types.Mixed) return value;
  if ([Date, String, Number, Boolean, Buffer, ObjectId, Decimal128].includes(definition)) {
    return castScalar(definition, value);
  }
  if (definition && typeof definition === "object") return castObject(definition, value);
  return value;
}

function castObject(definition, input) {
  if (!input || typeof input !== "object") return input;
  const output = { ...input };
  for (const [key, fieldDefinition] of Object.entries(definition || {})) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = castByDefinition(fieldDefinition, input[key]);
    }
  }
  return output;
}

function fieldDefault(definition) {
  if (definition instanceof Schema || Array.isArray(definition)) return undefined;
  if (!isFieldConfig(definition) || !Object.prototype.hasOwnProperty.call(definition, "default")) return undefined;
  return typeof definition.default === "function" ? definition.default() : clone(definition.default);
}

function applyDefaults(definition, target) {
  const output = target;
  for (const [key, fieldDefinition] of Object.entries(definition || {})) {
    if (output[key] === undefined) {
      const defaultValue = fieldDefault(fieldDefinition);
      if (defaultValue !== undefined) output[key] = defaultValue;
      else if (Array.isArray(fieldDefinition)) output[key] = [];
    }
    const nestedDefinition = fieldDefinition instanceof Schema
      ? fieldDefinition.definition
      : isFieldConfig(fieldDefinition) && fieldDefinition.type instanceof Schema
        ? fieldDefinition.type.definition
        : !isFieldConfig(fieldDefinition) && fieldDefinition && typeof fieldDefinition === "object" && !Array.isArray(fieldDefinition)
          ? fieldDefinition
          : null;
    if (nestedDefinition && output[key] && typeof output[key] === "object") applyDefaults(nestedDefinition, output[key]);
  }
  return output;
}

class Schema {
  constructor(definition = {}, options = {}) {
    this.definition = definition;
    this.options = options;
    this.methods = {};
    this.statics = {};
    this._indexes = [];
    this._pres = new Map();
    this._posts = new Map();
  }

  index(fields, options = {}) {
    this._indexes.push([fields, options]);
    return this;
  }

  pre(names, fn) {
    for (const name of Array.isArray(names) ? names : [names]) {
      const handlers = this._pres.get(name) || [];
      handlers.push(fn);
      this._pres.set(name, handlers);
    }
    return this;
  }

  post(names, fn) {
    for (const name of Array.isArray(names) ? names : [names]) {
      const handlers = this._posts.get(name) || [];
      handlers.push(fn);
      this._posts.set(name, handlers);
    }
    return this;
  }

  method(name, fn) {
    this.methods[name] = fn;
    return this;
  }

  static(name, fn) {
    this.statics[name] = fn;
    return this;
  }

  virtual() {
    return {
      get() { return this; },
      set() { return this; }
    };
  }

  plugin(fn, options) {
    fn(this, options);
    return this;
  }
}

Schema.Types = Types;
Schema.prototype.Types = Types;

function normalizeNamespace(value) {
  return String(value || "default").trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "default";
}

function defaultNamespace() {
  return normalizeNamespace(process.env.PG_DOCUMENT_NAMESPACE || "default");
}

function collectionName(modelName, schema) {
  if (schema?.options?.collection) return schema.options.collection;
  const lower = modelName.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

function requirePool() {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("SUPABASE_DB_URL is required");
    pool = new Pool({
      connectionString,
      max: Number(process.env.SUPABASE_DB_POOL_MAX || 30),
      min: Number(process.env.SUPABASE_DB_POOL_MIN || 2),
      idleTimeoutMillis: Number(process.env.SUPABASE_DB_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(process.env.SUPABASE_DB_CONNECT_TIMEOUT_MS || 5000),
      query_timeout: Number(process.env.SUPABASE_DB_QUERY_TIMEOUT_MS || 30000),
      statement_timeout: Number(process.env.SUPABASE_DB_STATEMENT_TIMEOUT_MS || 30000),
      ssl: { rejectUnauthorized: process.env.SUPABASE_DB_SSL_STRICT === "true" }
    });
    pool.on("error", (error) => connection.emit("error", error));
  }
  return pool;
}

class PgSession {
  constructor(client) {
    this.client = client;
    this.inTransaction = false;
  }

  async startTransaction() {
    if (!this.inTransaction) {
      await this.client.query("begin");
      this.inTransaction = true;
    }
  }

  async commitTransaction() {
    if (this.inTransaction) {
      await this.client.query("commit");
      this.inTransaction = false;
    }
  }

  async abortTransaction() {
    if (this.inTransaction) {
      await this.client.query("rollback");
      this.inTransaction = false;
    }
  }

  async withTransaction(fn) {
    await this.startTransaction();
    try {
      const result = await fn();
      await this.commitTransaction();
      return result;
    } catch (error) {
      await this.abortTransaction();
      throw error;
    }
  }

  async endSession() {
    if (this.inTransaction) await this.abortTransaction();
    this.client.release();
  }
}

async function startSession() {
  const client = await requirePool().connect();
  return new PgSession(client);
}

function normalizeFilter(value) {
  if (value instanceof RegExp) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128) return Number(value.toString());
  if (Array.isArray(value)) return value.map(normalizeFilter);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = normalizeFilter(item);
    return output;
  }
  return value;
}

function jsonPath(path) {
  return `{${String(path).split(".").map((part) => part.replace(/"/g, "")).join(",")}}`;
}

function nestedObject(path, value) {
  const output = {};
  setPath(output, path, value);
  return output;
}

function buildWhere(filter, startIndex = 3) {
  const params = [];
  const clauses = [];
  let supported = true;

  function add(value) {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  }

  function visit(input) {
    if (!input || Object.keys(input).length === 0) return "true";
    const local = [];
    for (const [path, condition] of Object.entries(input)) {
      if (path === "$or" || path === "$and" || path === "$nor") {
        const parts = Array.isArray(condition) ? condition.map((item) => visit(item)) : [];
        const joined = parts.length ? `(${parts.join(path === "$and" ? " and " : " or ")})` : "true";
        local.push(path === "$nor" ? `not ${joined}` : joined);
        continue;
      }
      if (path.startsWith("$")) {
        supported = false;
        continue;
      }

      const column = path === "_id" ? "id" : `data #>> '${jsonPath(path)}'`;
      if (condition instanceof RegExp) {
        const token = add(condition.source);
        local.push(`${column} ${condition.flags.includes("i") ? "~*" : "~"} ${token}`);
        continue;
      }

      if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date) && !(condition instanceof ObjectId)) {
        const operators = Object.keys(condition).filter((key) => key.startsWith("$"));
        if (operators.length) {
          for (const operator of operators) {
            const operand = condition[operator];
            if (operator === "$exists") {
              local.push(`${path === "_id" ? "id" : `data #> '${jsonPath(path)}'`} is ${operand ? "not " : ""}null`);
            } else if (operator === "$in" || operator === "$nin") {
              const values = (Array.isArray(operand) ? operand : []).map(serialize);
              const token = add(values.map(String));
              local.push(`${column} ${operator === "$nin" ? "<> all" : "= any"}(${token}::text[])`);
            } else if (["$gt", "$gte", "$lt", "$lte", "$ne"].includes(operator)) {
              const serialized = serialize(operand);
              const token = add(serialized);
              const sqlOperator = { $gt: ">", $gte: ">=", $lt: "<", $lte: "<=", $ne: "<>" }[operator];
              if (operand instanceof Date) local.push(`(${column})::timestamptz ${sqlOperator} ${token}::timestamptz`);
              else if (typeof operand === "number") local.push(`(${column})::numeric ${sqlOperator} ${token}::numeric`);
              else local.push(`${column} ${sqlOperator} ${token}::text`);
            } else if (operator === "$regex") {
              const regex = operand instanceof RegExp ? operand : new RegExp(String(operand), condition.$options || "");
              const token = add(regex.source);
              local.push(`${column} ${regex.flags.includes("i") ? "~*" : "~"} ${token}`);
            } else if (operator === "$type") {
              const expected = String(operand);
              const typeToken = add(expected === "objectId" ? "string" : expected);
              local.push(`jsonb_typeof(data #> '${jsonPath(path)}') = ${typeToken}`);
            } else if (operator === "$not") {
              local.push(`not (${visit({ [path]: operand })})`);
            } else if (operator !== "$options") {
              supported = false;
            }
          }
          continue;
        }
      }

      const serialized = serialize(condition);
      if (serialized === null) {
        local.push(`(${path === "_id" ? "id is null" : `data #> '${jsonPath(path)}' is null or data #> '${jsonPath(path)}' = 'null'::jsonb`})`);
      } else if (path === "_id") {
        local.push(`id = ${add(String(serialized))}`);
      } else {
        const token = add(JSON.stringify(nestedObject(path, serialized)));
        local.push(`data @> ${token}::jsonb`);
      }
    }
    return local.length ? `(${local.join(" and ")})` : "true";
  }

  clauses.push(visit(normalizeFilter(filter || {})));
  return { sql: clauses.join(" and "), params, supported };
}

function normalizeForMingo(doc) {
  return normalizeFilter(serialize(doc));
}

function matchesFilter(doc, filter) {
  try {
    return new MingoQuery(normalizeFilter(filter || {})).test(normalizeForMingo(doc));
  } catch {
    return true;
  }
}

function parseSelect(selection) {
  if (!selection) return null;
  if (typeof selection === "string") {
    const projection = {};
    for (const part of selection.split(/\s+/).filter(Boolean)) {
      projection[part.startsWith("-") ? part.slice(1) : part] = part.startsWith("-") ? 0 : 1;
    }
    return projection;
  }
  return selection;
}

function applyProjection(doc, selection) {
  const projection = parseSelect(selection);
  if (!projection) return doc;
  const entries = Object.entries(projection);
  const inclusive = entries.some(([key, value]) => key !== "_id" && Boolean(value));
  if (inclusive) {
    const result = {};
    for (const [path, enabled] of entries) {
      if (!enabled) continue;
      const value = getPath(doc, path);
      if (value !== undefined) setPath(result, path, value);
    }
    if (projection._id !== 0 && doc._id !== undefined) result._id = doc._id;
    return result;
  }
  const result = { ...doc };
  for (const [path, enabled] of entries) if (!enabled) unsetPath(result, path);
  return result;
}

function sortDocuments(documents, sort) {
  if (!sort) return documents;
  const spec = typeof sort === "string"
    ? Object.fromEntries(sort.split(/\s+/).filter(Boolean).map((field) => [field.replace(/^-/, ""), field.startsWith("-") ? -1 : 1]))
    : sort;
  return [...documents].sort((left, right) => {
    for (const [path, directionValue] of Object.entries(spec || {})) {
      const direction = Number(directionValue) < 0 ? -1 : 1;
      const a = serialize(getPath(left, path));
      const b = serialize(getPath(right, path));
      if (a == null && b == null) continue;
      if (a == null) return -1 * direction;
      if (b == null) return 1 * direction;
      if (a < b) return -1 * direction;
      if (a > b) return 1 * direction;
    }
    return 0;
  });
}

async function runHook(handler, context, args = []) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const next = (error) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };
    try {
      const expectsNext = handler.length > args.length;
      const result = expectsNext ? handler.call(context, ...args, next) : handler.call(context, ...args);
      if (result && typeof result.then === "function") result.then(() => next()).catch(next);
      else if (!expectsNext) next();
    } catch (error) {
      next(error);
    }
  });
}

async function runHooks(schema, kind, name, context, args = []) {
  const handlers = (kind === "pre" ? schema._pres : schema._posts).get(name) || [];
  for (const handler of handlers) await runHook(handler, context, args);
}

function duplicateError(collection, field) {
  const error = new Error(`E11000 duplicate key error collection: ${collection} index: ${field}`);
  error.code = 11000;
  error.codeName = "DuplicateKey";
  return error;
}

async function withClient(session, transaction, fn) {
  if (session?.client) {
    if (transaction && !session.inTransaction) await session.startTransaction();
    return fn(session.client);
  }
  const client = await requirePool().connect();
  try {
    if (transaction) await client.query("begin");
    const result = await fn(client);
    if (transaction) await client.query("commit");
    return result;
  } catch (error) {
    if (transaction) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function mapPgError(error, collection) {
  if (error?.code === "23505") return duplicateError(collection, error.constraint || "unique");
  return error;
}

function applyUpdate(document, update, isInsert = false) {
  const target = clone(document || {});
  const operatorUpdate = Object.keys(update || {}).some((key) => key.startsWith("$"));
  if (!operatorUpdate) return { ...target, ...clone(update) };

  if (isInsert && update.$setOnInsert) {
    for (const [path, value] of Object.entries(update.$setOnInsert)) setPath(target, path, clone(value));
  }
  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set)) setPath(target, path, clone(value));
  }
  if (update.$unset) {
    for (const path of Object.keys(update.$unset)) unsetPath(target, path);
  }
  if (update.$inc) {
    for (const [path, value] of Object.entries(update.$inc)) {
      const current = getPath(target, path);
      if (typeof current === "string" || typeof value === "string") {
        const left = BigInt(current || "0");
        setPath(target, path, (left + BigInt(String(value))).toString());
      } else {
        setPath(target, path, Number(current || 0) + Number(value));
      }
    }
  }
  if (update.$push) {
    for (const [path, value] of Object.entries(update.$push)) {
      const current = Array.isArray(getPath(target, path)) ? [...getPath(target, path)] : [];
      if (value && typeof value === "object" && Array.isArray(value.$each)) current.push(...clone(value.$each));
      else current.push(clone(value));
      setPath(target, path, current);
    }
  }
  if (update.$addToSet) {
    for (const [path, value] of Object.entries(update.$addToSet)) {
      const current = Array.isArray(getPath(target, path)) ? [...getPath(target, path)] : [];
      const values = value && typeof value === "object" && Array.isArray(value.$each) ? value.$each : [value];
      for (const item of values) if (!current.some((existing) => valuesEqual(existing, item))) current.push(clone(item));
      setPath(target, path, current);
    }
  }
  if (update.$pull) {
    for (const [path, value] of Object.entries(update.$pull)) {
      const current = Array.isArray(getPath(target, path)) ? getPath(target, path) : [];
      setPath(target, path, current.filter((item) => !matchesFilter({ value: item }, { value })));
    }
  }
  if (update.$currentDate) {
    for (const path of Object.keys(update.$currentDate)) setPath(target, path, new Date());
  }
  return target;
}

class PgQuery {
  constructor(modelClass, operation, payload = {}) {
    this.modelClass = modelClass;
    this.operation = operation;
    this.payload = payload;
    this.options = { ...(payload.options || {}) };
    this._lean = false;
    this._sort = null;
    this._limit = null;
    this._skip = 0;
    this._select = payload.projection || null;
    this._session = payload.options?.session || null;
  }

  lean(value = true) { this._lean = value; return this; }
  sort(value) { this._sort = value; return this; }
  limit(value) { this._limit = Math.max(0, Number(value)); return this; }
  skip(value) { this._skip = Math.max(0, Number(value)); return this; }
  select(value) { this._select = value; return this; }
  populate() { return this; }
  session(value) { this._session = value; return this; }
  setOptions(value) { Object.assign(this.options, value || {}); return this; }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }

  cursor() {
    let loaded = null;
    let index = 0;
    const load = async () => {
      if (!loaded) loaded = Promise.resolve(this.exec()).then((value) => Array.isArray(value) ? value : value ? [value] : []);
      return loaded;
    };
    return {
      next: async () => {
        const rows = await load();
        return index < rows.length ? rows[index++] : null;
      },
      close: async () => { index = Number.MAX_SAFE_INTEGER; },
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            const value = await this.next();
            return value == null ? { done: true, value: undefined } : { done: false, value };
          }
        };
      }
    };
  }

  async exec() {
    if (this.operation === "find" || this.operation === "findOne") return this.execFind();
    if (this.operation === "count") {
      const rows = await this.modelClass._findRaw(this.payload.filter, this._session);
      return rows.filter((row) => matchesFilter(row, this.payload.filter)).length;
    }
    if (this.operation === "distinct") {
      const rows = await this.modelClass._findRaw(this.payload.filter, this._session);
      const values = rows.flatMap((row) => {
        const value = getPath(row, this.payload.path);
        return Array.isArray(value) ? value : [value];
      }).filter((value) => value !== undefined);
      return [...new Map(values.map((value) => [JSON.stringify(serialize(value)), value])).values()];
    }
    if (this.operation === "update") return this.modelClass._update(this.payload.filter, this.payload.update, { ...this.options, session: this._session }, this.payload.many);
    if (this.operation === "findOneAndUpdate") return this.modelClass._findOneAndUpdate(this.payload.filter, this.payload.update, { ...this.options, lean: this._lean, session: this._session });
    if (this.operation === "delete") return this.modelClass._delete(this.payload.filter, { ...this.options, session: this._session }, this.payload.many, false);
    if (this.operation === "findOneAndDelete") return this.modelClass._delete(this.payload.filter, { ...this.options, lean: this._lean, session: this._session }, false, true);
    throw new Error(`Unsupported query operation: ${this.operation}`);
  }

  async execFind() {
    let rows = await this.modelClass._findRaw(this.payload.filter, this._session);
    rows = rows.filter((row) => matchesFilter(row, this.payload.filter));
    rows = sortDocuments(rows, this._sort);
    if (this._skip) rows = rows.slice(this._skip);
    if (this._limit != null) rows = rows.slice(0, this._limit);
    if (this.operation === "findOne") rows = rows.slice(0, 1);
    const mapped = rows.map((row) => {
      const value = this._lean ? this.modelClass._lean(row) : this.modelClass._hydrate(row);
      return applyProjection(value, this._select);
    });
    return this.operation === "findOne" ? mapped[0] || null : mapped;
  }
}

function createModel(modelName, schema, modelConnection) {
  const tableCollection = collectionName(modelName, schema);
  const hasExplicitIdDefinition = Object.prototype.hasOwnProperty.call(schema.definition, "_id");
  const idDefinition = schema.definition._id;

  // Mongo defaults `_id` to ObjectId, but application-defined identifiers are
  // allowed to be strings. In particular, queue/idempotency records use stable
  // IDs such as `swap_crypto_<user>_<key>` and must never pass through the
  // ObjectId constructor. Keep this decision at the adapter boundary so every
  // model operation (create, upsert, hydrate, lean, and findById) uses the same
  // cast semantics.
  function isStringIdDefinition(definition) {
    if (definition === String) return true;
    return Boolean(
      definition &&
      typeof definition === "object" &&
      definition.type === String
    );
  }

  function castDocumentId(value) {
    if (hasExplicitIdDefinition) {
      if (value == null) return value;
      if (isStringIdDefinition(idDefinition)) return String(value);
      return castByDefinition(idDefinition, value);
    }
    if (value instanceof ObjectId) return value;
    if (value == null || value === "") return new ObjectId();
    const asString = String(value);
    // Application-defined string _ids (e.g. op_..., q_..., swap_...) must pass
    // through untouched. Only values shaped like a BSON ObjectId are coerced.
    return ObjectId.isValid(asString) ? new ObjectId(asString) : value;
  }

  class ModelDocument {
    constructor(data = {}, state = {}) {
      const defaultsApplied = applyDefaults(schema.definition, { ...data });
      const cast = castObject(schema.definition, defaultsApplied);
      Object.assign(this, cast);
      this._id = castDocumentId(data._id);
      this.isNew = state.isNew !== false;
      this.__original = serialize(this.toObject());
      for (const [name, method] of Object.entries(schema.methods)) {
        if (!this[name]) Object.defineProperty(this, name, { value: method.bind(this), enumerable: false });
      }
    }

    get id() { return this._id.toString(); }
    get(path) { return getPath(this, path); }
    set(path, value) {
      if (path && typeof path === "object") Object.assign(this, path);
      else setPath(this, path, value);
      return this;
    }
    markModified() {}
    isModified(path) {
      if (this.isNew) return true;
      if (!path) return JSON.stringify(serialize(this.toObject())) !== JSON.stringify(this.__original);
      return !valuesEqual(getPath(this.__original, path), serialize(getPath(this, path)));
    }
    toObject() {
      const output = {};
      for (const [key, value] of Object.entries(this)) {
        if (key.startsWith("__") || key === "isNew") continue;
        output[key] = value;
      }
      output._id = this._id;
      return output;
    }
    toJSON() { return serialize(this.toObject()); }
    async save(options = {}) {
      if (this._id == null || String(this._id).length === 0) {
        throw new Error(`${modelName} requires an _id value`);
      }
      await runHooks(schema, "pre", "validate", this);
      await runHooks(schema, "pre", "save", this);
      const now = new Date();
      if (schema.options.timestamps) {
        if (this.isNew && !this.createdAt) this.createdAt = now;
        this.updatedAt = now;
      }
      const raw = serialize(this.toObject());
      await withClient(options.session, true, async (client) => {
        try {
          await client.query(
            `insert into public.monera_documents (namespace, collection, id, data, created_at, updated_at)
             values ($1, $2, $3, $4::jsonb, coalesce(($4::jsonb->>'createdAt')::timestamptz, now()), coalesce(($4::jsonb->>'updatedAt')::timestamptz, now()))
             on conflict (namespace, collection, id) do update
             set data = excluded.data, updated_at = excluded.updated_at`,
            [modelConnection.namespace, tableCollection, this._id.toString(), JSON.stringify(raw)]
          );
        } catch (error) {
          throw mapPgError(error, tableCollection);
        }
      });
      this.isNew = false;
      this.__original = serialize(this.toObject());
      await runHooks(schema, "post", "save", this, [this]);
      return this;
    }
    async deleteOne(options = {}) {
      return ModelDocument.deleteOne({ _id: this._id }, options);
    }
  }

  Object.defineProperty(ModelDocument, "name", { value: modelName });
  ModelDocument.modelName = modelName;
  ModelDocument.schema = schema;
  ModelDocument._collectionName = tableCollection;
  ModelDocument._connection = modelConnection;
  ModelDocument.collection = {
    collectionName: tableCollection,
    indexes: async () => schema._indexes.map(([key, options], index) => ({ key, name: options.name || `index_${index}`, ...options })),
    dropIndex: async () => ({ ok: 1 }),
    createIndex: async (_fields, options = {}) => options.name || "index"
  };

  ModelDocument._hydrate = (raw) => {
    const data = castObject(schema.definition, deserialize(raw));
    return new ModelDocument(data, { isNew: false });
  };
  ModelDocument._lean = (raw) => {
    const data = castObject(schema.definition, deserialize(raw));
    data._id = castDocumentId(raw._id);
    return data;
  };
  ModelDocument._findRaw = async (filter = {}, session = null, lock = false) => {
    const where = buildWhere(filter);
    const params = [modelConnection.namespace, tableCollection, ...where.params];
    const rows = await withClient(session, false, async (client) => {
      const result = await client.query(
        `select id, data from public.monera_documents
          where namespace = $1 and collection = $2 and ${where.sql}
          ${lock ? "for update" : ""}`,
        params
      );
      return result.rows;
    });
    return rows.map((row) => ({ ...row.data, _id: row.id }));
  };

  ModelDocument.create = async (docs, options = {}) => {
    if (Array.isArray(docs)) {
      const output = [];
      for (const item of docs) output.push(await new ModelDocument(item).save(options));
      return output;
    }
    return new ModelDocument(docs).save(options);
  };
  ModelDocument.insertMany = (docs, options = {}) => ModelDocument.create(docs, options);
  ModelDocument.createCollection = async () => ModelDocument.collection;
  ModelDocument.find = (filter = {}, projection = null, options = {}) => new PgQuery(ModelDocument, "find", { filter, projection, options });
  ModelDocument.findOne = (filter = {}, projection = null, options = {}) => new PgQuery(ModelDocument, "findOne", { filter, projection, options });
  ModelDocument.findById = (id, projection = null, options = {}) => ModelDocument.findOne({ _id: id }, projection, options);
  ModelDocument.updateOne = (filter, update, options = {}) => new PgQuery(ModelDocument, "update", { filter, update, options, many: false });
  ModelDocument.updateMany = (filter, update, options = {}) => new PgQuery(ModelDocument, "update", { filter, update, options, many: true });
  ModelDocument.findOneAndUpdate = (filter, update, options = {}) => new PgQuery(ModelDocument, "findOneAndUpdate", { filter, update, options });
  ModelDocument.findByIdAndUpdate = (id, update, options = {}) => ModelDocument.findOneAndUpdate({ _id: id }, update, options);
  ModelDocument.deleteOne = (filter, options = {}) => new PgQuery(ModelDocument, "delete", { filter, options, many: false });
  ModelDocument.deleteMany = (filter, options = {}) => new PgQuery(ModelDocument, "delete", { filter, options, many: true });
  ModelDocument.findOneAndDelete = (filter, options = {}) => new PgQuery(ModelDocument, "findOneAndDelete", { filter, options });
  ModelDocument.findByIdAndDelete = (id, options = {}) => ModelDocument.findOneAndDelete({ _id: id }, options);
  ModelDocument.countDocuments = (filter = {}) => new PgQuery(ModelDocument, "count", { filter });
  ModelDocument.estimatedDocumentCount = () => ModelDocument.countDocuments({});
  ModelDocument.exists = async (filter) => {
    const value = await ModelDocument.findOne(filter).select("_id").lean();
    return value ? { _id: value._id } : null;
  };
  ModelDocument.distinct = (path, filter = {}) => new PgQuery(ModelDocument, "distinct", { path, filter });
  ModelDocument.aggregate = async (pipeline = []) => {
    const initialMatch = pipeline[0]?.$match || {};
    const rows = await ModelDocument._findRaw(initialMatch);
    const normalizedRows = rows.map(normalizeForMingo);
    return new Aggregator(pipeline).run(normalizedRows);
  };
  ModelDocument.bulkWrite = async (operations, options = {}) => {
    const result = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
    for (const operation of operations || []) {
      if (operation.insertOne) {
        await ModelDocument.create(operation.insertOne.document, options);
        result.insertedCount += 1;
      } else if (operation.updateOne) {
        const updateResult = await ModelDocument.updateOne(operation.updateOne.filter, operation.updateOne.update, { ...options, ...operation.updateOne });
        result.matchedCount += updateResult.matchedCount || 0;
        result.modifiedCount += updateResult.modifiedCount || 0;
        result.upsertedCount += updateResult.upsertedCount || 0;
      } else if (operation.updateMany) {
        const updateResult = await ModelDocument.updateMany(operation.updateMany.filter, operation.updateMany.update, { ...options, ...operation.updateMany });
        result.matchedCount += updateResult.matchedCount || 0;
        result.modifiedCount += updateResult.modifiedCount || 0;
      } else if (operation.deleteOne) {
        const deleteResult = await ModelDocument.deleteOne(operation.deleteOne.filter, options);
        result.deletedCount += deleteResult.deletedCount || 0;
      } else if (operation.deleteMany) {
        const deleteResult = await ModelDocument.deleteMany(operation.deleteMany.filter, options);
        result.deletedCount += deleteResult.deletedCount || 0;
      }
    }
    return result;
  };
  ModelDocument.syncIndexes = async () => [];
  ModelDocument.watch = () => {
    throw new Error("PostgreSQL adapter: $changeStream is not supported; use polling");
  };

  ModelDocument._update = async (filter, update, options = {}, many = false) => {
    const hookContext = { getUpdate: () => update, getQuery: () => filter, options };
    await runHooks(schema, "pre", many ? "updateMany" : "updateOne", hookContext);
    return withClient(options.session, true, async (client) => {
      const session = { client, inTransaction: true };
      let rows = await ModelDocument._findRaw(filter, session, true);
      rows = rows.filter((row) => matchesFilter(row, filter));
      if (!many) rows = rows.slice(0, 1);
      if (!rows.length && options.upsert) {
        const base = {};
        for (const [key, value] of Object.entries(filter || {})) if (!key.startsWith("$") && !(value && typeof value === "object" && Object.keys(value).some((item) => item.startsWith("$")))) setPath(base, key, clone(value));
        const created = applyUpdate(base, update, true);
        const doc = new ModelDocument(created);
        await doc.save({ session });
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
      }
      let modifiedCount = 0;
      for (const row of rows) {
        const next = applyUpdate(row, update, false);
        if (schema.options.timestamps) next.updatedAt = new Date();
        if (!valuesEqual(row, next)) {
          const doc = new ModelDocument(next, { isNew: false });
          await runHooks(schema, "pre", "validate", doc);
          await client.query(
            `update public.monera_documents set data = $4::jsonb, updated_at = now()
              where namespace = $1 and collection = $2 and id = $3`,
            [modelConnection.namespace, tableCollection, String(row._id), JSON.stringify(serialize(doc.toObject()))]
          );
          modifiedCount += 1;
        }
      }
      return { acknowledged: true, matchedCount: rows.length, modifiedCount, upsertedCount: 0, upsertedId: null };
    });
  };

  ModelDocument._findOneAndUpdate = async (filter, update, options = {}) => {
    const hookContext = { getUpdate: () => update, getQuery: () => filter, options };
    await runHooks(schema, "pre", "findOneAndUpdate", hookContext);
    return withClient(options.session, true, async (client) => {
      const session = { client, inTransaction: true };
      let rows = await ModelDocument._findRaw(filter, session, true);
      rows = rows.filter((row) => matchesFilter(row, filter)).slice(0, 1);
      const previous = rows[0] || null;
      if (!previous && options.upsert) {
        const base = {};
        for (const [key, value] of Object.entries(filter || {})) if (!key.startsWith("$") && !(value && typeof value === "object" && Object.keys(value).some((item) => item.startsWith("$")))) setPath(base, key, clone(value));
        const doc = new ModelDocument(applyUpdate(base, update, true));
        await doc.save({ session });
        return options.lean ? doc.toObject() : doc;
      }
      if (!previous) return null;
      const next = applyUpdate(previous, update, false);
      if (schema.options.timestamps) next.updatedAt = new Date();
      const doc = new ModelDocument(next, { isNew: false });
      await runHooks(schema, "pre", "validate", doc);
      await client.query(
        `update public.monera_documents set data = $4::jsonb, updated_at = now()
          where namespace = $1 and collection = $2 and id = $3`,
        [modelConnection.namespace, tableCollection, String(previous._id), JSON.stringify(serialize(doc.toObject()))]
      );
      const selected = options.new || options.returnDocument === "after" ? doc : ModelDocument._hydrate(previous);
      return options.lean ? selected.toObject() : selected;
    });
  };

  ModelDocument._delete = async (filter, options = {}, many = false, returnDocument = false) => {
    return withClient(options.session, true, async (client) => {
      const session = { client, inTransaction: true };
      let rows = await ModelDocument._findRaw(filter, session, true);
      rows = rows.filter((row) => matchesFilter(row, filter));
      if (!many) rows = rows.slice(0, 1);
      for (const row of rows) {
        await client.query(
          "delete from public.monera_documents where namespace = $1 and collection = $2 and id = $3",
          [modelConnection.namespace, tableCollection, String(row._id)]
        );
      }
      if (returnDocument) return rows[0] ? ModelDocument._hydrate(rows[0]) : null;
      return { acknowledged: true, deletedCount: rows.length };
    });
  };

  for (const [name, fn] of Object.entries(schema.statics)) ModelDocument[name] = fn.bind(ModelDocument);
  return ModelDocument;
}

class PgConnection extends EventEmitter {
  constructor(namespace = defaultNamespace()) {
    super();
    this.namespace = normalizeNamespace(namespace);
    this.name = this.namespace;
    this.readyState = 0;
    this.models = Object.create(null);
  }

  model(name, schema, collectionOverride) {
    if (this.models[name]) return this.models[name];
    if (!schema) throw new Error(`Schema has not been registered for model "${name}"`);
    if (collectionOverride) schema.options.collection = collectionOverride;
    const created = createModel(name, schema, this);
    this.models[name] = created;
    return created;
  }

  collection(name) {
    return {
      collectionName: name,
      indexes: async () => [],
      dropIndex: async () => ({ ok: 1 }),
      createIndex: async (_fields, options = {}) => options.name || "index"
    };
  }

  useDb(name) {
    return new PgConnection(name);
  }

  async asPromise() {
    await connect();
    this.readyState = 1;
    return this;
  }

  async close() {
    this.readyState = 0;
  }
}

const connection = new PgConnection();

function model(name, schema, collectionOverride) {
  if (models[name]) return models[name];
  const created = connection.model(name, schema, collectionOverride);
  models[name] = created;
  return created;
}

async function connect(_uri, _options = {}) {
  requirePool();
  await pool.query("select 1");
  connection.namespace = defaultNamespace();
  connection.name = connection.namespace;
  connection.readyState = 1;
  queueMicrotask(() => connection.emit("connected"));
  return database;
}

async function disconnect() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  connection.readyState = 0;
  connection.emit("disconnected");
}

function createConnection(_uri, options = {}) {
  return new PgConnection(options.namespace || defaultNamespace());
}

function isValidObjectId(value) {
  return ObjectId.isValid(value);
}

const database = {
  Schema,
  Types,
  model,
  models,
  connect,
  disconnect,
  createConnection,
  startSession,
  isValidObjectId,
  connection
};

module.exports = database;
module.exports.default = database;
module.exports.Schema = Schema;
module.exports.Types = Types;
module.exports.ObjectId = ObjectId;
module.exports.Decimal128 = Decimal128;
module.exports.model = model;
module.exports.models = models;
module.exports.connect = connect;
module.exports.disconnect = disconnect;
module.exports.createConnection = createConnection;
module.exports.startSession = startSession;
module.exports.isValidObjectId = isValidObjectId;
module.exports.connection = connection;
