import { EventEmitter } from "events";

export type AnyObject = Record<string, any>;
export type FilterQuery<T> = AnyObject;
export type UpdateQuery<T> = AnyObject;
export type ProjectionType<T> = AnyObject | string;

export class ObjectId {
  constructor(value?: string | ObjectId);
  static isValid(value: unknown): boolean;
  static createFromHexString(value: string): ObjectId;
  equals(value: unknown): boolean;
  toHexString(): string;
  toString(): string;
  toJSON(): string;
}

export class Decimal128 {
  static fromString(value: string): Decimal128;
  toString(): string;
  toJSON(): string;
}

export const Types: {
  ObjectId: typeof ObjectId;
  Decimal128: typeof Decimal128;
  Mixed: any;
};

export interface ClientSession {
  client: any;
  inTransaction: boolean;
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  endSession(): Promise<void>;
}

export interface Document<T = any, TQueryHelpers = any, DocType = any> {
  _id: ObjectId;
  id: string;
  isNew: boolean;
  save(options?: { session?: ClientSession }): Promise<this>;
  deleteOne(options?: { session?: ClientSession }): Promise<any>;
  toObject(options?: AnyObject): T & AnyObject;
  toJSON(options?: AnyObject): T & AnyObject;
  get(path: string): any;
  set(path: string | AnyObject, value?: any): this;
  isModified(path?: string): boolean;
  markModified(path: string): void;
}

export interface Query<ResultType = any> extends PromiseLike<ResultType> {
  lean(value?: boolean): Query<any>;
  sort(value: AnyObject | string): Query<ResultType>;
  limit(value: number): Query<ResultType>;
  skip(value: number): Query<ResultType>;
  select(value: AnyObject | string): Query<ResultType>;
  populate(...args: any[]): Query<ResultType>;
  session(value: ClientSession | null): Query<ResultType>;
  setOptions(value: AnyObject): Query<ResultType>;
  exec(): Promise<ResultType>;
  cursor(): AsyncIterable<any> & { next(): Promise<any>; close(): Promise<void> };
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<ResultType | TResult>;
}

export interface Model<T = any> {
  new (doc?: AnyObject): T & Document<T>;
  modelName: string;
  collection: any;
  schema: Schema<T>;
  create(doc: AnyObject, options?: AnyObject): Promise<T & Document<T>>;
  create(docs: AnyObject[], options?: AnyObject): Promise<Array<T & Document<T>>>;
  insertMany(docs: AnyObject[], options?: AnyObject): Promise<Array<T & Document<T>>>;
  find(filter?: FilterQuery<T>, projection?: ProjectionType<T>, options?: AnyObject): Query<Array<T & Document<T>>>;
  findOne(filter?: FilterQuery<T>, projection?: ProjectionType<T>, options?: AnyObject): Query<(T & Document<T>) | null>;
  findById(id: any, projection?: ProjectionType<T>, options?: AnyObject): Query<(T & Document<T>) | null>;
  findOneAndUpdate(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: AnyObject): Query<(T & Document<T>) | null>;
  findByIdAndUpdate(id: any, update: UpdateQuery<T>, options?: AnyObject): Query<(T & Document<T>) | null>;
  findOneAndDelete(filter: FilterQuery<T>, options?: AnyObject): Query<(T & Document<T>) | null>;
  findByIdAndDelete(id: any, options?: AnyObject): Query<(T & Document<T>) | null>;
  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: AnyObject): Query<any>;
  updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: AnyObject): Query<any>;
  deleteOne(filter: FilterQuery<T>, options?: AnyObject): Query<any>;
  deleteMany(filter: FilterQuery<T>, options?: AnyObject): Query<any>;
  countDocuments(filter?: FilterQuery<T>): Query<number>;
  estimatedDocumentCount(): Query<number>;
  exists(filter: FilterQuery<T>): Query<any>;
  distinct(path: string, filter?: FilterQuery<T>): Query<any[]>;
  aggregate(pipeline?: AnyObject[]): Promise<any[]>;
  bulkWrite(operations: AnyObject[], options?: AnyObject): Promise<any>;
  syncIndexes(): Promise<string[]>;
  watch(pipeline?: AnyObject[], options?: AnyObject): EventEmitter & { close(): Promise<void> };
}

export class Schema<T = any, TModel = any, TInstanceMethods = any> {
  static Types: {
    ObjectId: typeof ObjectId;
    Decimal128: typeof Decimal128;
    Mixed: any;
  };
  Types: typeof Schema.Types;
  definition: AnyObject;
  options: AnyObject;
  methods: AnyObject;
  statics: AnyObject;
  constructor(definition?: AnyObject, options?: AnyObject);
  index(fields: AnyObject, options?: AnyObject): this;
  pre(name: string | string[], fn: (...args: any[]) => any): this;
  post(name: string | string[], fn: (...args: any[]) => any): this;
  method(name: string, fn: (...args: any[]) => any): this;
  static(name: string, fn: (...args: any[]) => any): this;
  virtual(name: string, options?: AnyObject): AnyObject;
  plugin(fn: (...args: any[]) => any, options?: AnyObject): this;
}

export interface Connection extends EventEmitter {
  readyState: number;
  name: string;
  models: Record<string, Model<any>>;
  collection(name: string): any;
  model<T = any>(name: string, schema?: Schema<T>): Model<T>;
  useDb(name: string): Connection;
  asPromise(): Promise<Connection>;
  close(): Promise<void>;
}

export function model<T = any>(name: string, schema?: Schema<T>): Model<T>;
export function connect(uri?: string, options?: AnyObject): Promise<typeof mongoose>;
export function disconnect(): Promise<void>;
export function createConnection(uri?: string, options?: AnyObject): Connection;
export function startSession(): Promise<ClientSession>;
export function isValidObjectId(value: unknown): boolean;

declare const mongoose: {
  Schema: typeof Schema;
  Types: typeof Types;
  model: typeof model;
  models: Record<string, Model<any>>;
  connect: typeof connect;
  disconnect: typeof disconnect;
  createConnection: typeof createConnection;
  startSession: typeof startSession;
  isValidObjectId: typeof isValidObjectId;
  connection: Connection;
};

export default mongoose;
