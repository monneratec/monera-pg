/// <reference types="node" />

import { EventEmitter } from "events";

export as namespace mongoose;

export type AnyObject = Record<string, any>;
export type FilterQuery<T = any> = AnyObject;
export type UpdateQuery<T = any> = AnyObject;
export type ProjectionType<T = any> = AnyObject | string;
export type HydratedDocument<T = any> = T & Document;

export namespace Types {
  class ObjectId {
    constructor(value?: string | ObjectId);
    static isValid(value: unknown): boolean;
    static createFromHexString(value: string): ObjectId;
    equals(value: unknown): boolean;
    toHexString(): string;
    toString(): string;
    toJSON(): string;
  }

  class Decimal128 {
    static fromString(value: string): Decimal128;
    toString(): string;
    toJSON(): string;
  }

  const Mixed: any;
}

export import ObjectId = Types.ObjectId;
export import Decimal128 = Types.Decimal128;

export interface ClientSession {
  client: any;
  inTransaction: boolean;
  startTransaction(options?: AnyObject): Promise<void>;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  withTransaction<T>(fn: () => Promise<T>, options?: AnyObject): Promise<T>;
  endSession(): Promise<void>;
}

export interface Document<T = any, TQueryHelpers = any, DocType = any> {
  [key: string]: any;
  _id: any;
  id: string;
  isNew: boolean;
  save(options?: { session?: ClientSession }): Promise<this>;
  deleteOne(options?: { session?: ClientSession }): Promise<any>;
  toObject<TObject = AnyObject>(options?: AnyObject): TObject;
  toJSON<TObject = AnyObject>(options?: AnyObject): TObject;
  get(path: string): any;
  set(path: string | AnyObject, value?: any): this;
  isModified(path?: string): boolean;
  markModified(path: string): void;
}

export interface Query<ResultType = any> extends Promise<ResultType> {
  lean<LeanResultType = ResultType>(value?: boolean): Query<LeanResultType>;
  sort(value: AnyObject | string): Query<ResultType>;
  limit(value: number): Query<ResultType>;
  skip(value: number): Query<ResultType>;
  select<SelectedType = ResultType>(value: AnyObject | string): Query<SelectedType>;
  populate(...args: any[]): Query<ResultType>;
  session(value: ClientSession | null): Query<ResultType>;
  setOptions(value: AnyObject): Query<ResultType>;
  exec(): Promise<ResultType>;
  cursor(): AsyncIterable<any> & { next(): Promise<any>; close(): Promise<void> };
}

export interface Model<T = any> {
  [key: string]: any;
  new (doc?: AnyObject): T & Document<T>;
  modelName: string;
  collection: any;
  schema: Schema<T>;
  create(...args: any[]): Promise<any>;
  createCollection(options?: AnyObject): Promise<any>;
  insertMany(...args: any[]): Promise<any>;
  find<ResultDoc = T>(...args: any[]): Query<Array<ResultDoc & Document<ResultDoc>>>;
  findOne<ResultDoc = T>(...args: any[]): Query<(ResultDoc & Document<ResultDoc>) | null>;
  findById<ResultDoc = T>(...args: any[]): Query<(ResultDoc & Document<ResultDoc>) | null>;
  findOneAndUpdate<ResultDoc = T>(...args: any[]): Query<any>;
  findByIdAndUpdate<ResultDoc = T>(...args: any[]): Query<any>;
  findOneAndDelete<ResultDoc = T>(...args: any[]): Query<any>;
  findByIdAndDelete<ResultDoc = T>(...args: any[]): Query<any>;
  updateOne(...args: any[]): Query<any>;
  updateMany(...args: any[]): Query<any>;
  deleteOne(...args: any[]): Query<any>;
  deleteMany(...args: any[]): Query<any>;
  countDocuments(...args: any[]): Query<number>;
  estimatedDocumentCount(...args: any[]): Query<number>;
  exists(...args: any[]): Query<any>;
  distinct(...args: any[]): Query<any[]>;
  aggregate<ResultType = any>(pipeline?: AnyObject[]): Promise<ResultType[]>;
  bulkWrite(...args: any[]): Promise<any>;
  syncIndexes(): Promise<string[]>;
  watch(...args: any[]): EventEmitter & { close(): Promise<void> };
}

export class Schema<T = any, TModel = any, TInstanceMethods = any> {
  static Types: {
    ObjectId: typeof Types.ObjectId;
    Decimal128: typeof Types.Decimal128;
    Mixed: any;
  };
  Types: typeof Schema.Types;
  definition: AnyObject;
  options: AnyObject;
  methods: AnyObject;
  statics: AnyObject;
  constructor(definition?: AnyObject, options?: AnyObject);
  index(fields: AnyObject, options?: AnyObject): this;
  pre(name: string | string[], fn: (this: any, ...args: any[]) => any): this;
  post(name: string | string[], fn: (this: any, ...args: any[]) => any): this;
  method(name: string, fn: (this: any, ...args: any[]) => any): this;
  static(name: string, fn: (...args: any[]) => any): this;
  virtual(name: string, options?: AnyObject): AnyObject;
  plugin(fn: (...args: any[]) => any, options?: AnyObject): this;
}

export interface Connection extends EventEmitter {
  [key: string]: any;
  readyState: number;
  name: string;
  models: Record<string, Model<any>>;
  collection(name: string): any;
  model<T = any>(name: string, schema?: Schema<T>, collection?: string): Model<T>;
  useDb(name: string): Connection;
  asPromise(): Promise<Connection>;
  close(): Promise<void>;
}

export function model<T = any>(name: string, schema?: Schema<T>, collection?: string): Model<T>;
export function connect(uri?: string, options?: AnyObject): Promise<Mongoose>;
export function disconnect(): Promise<void>;
export function createConnection(uri?: string, options?: AnyObject): Connection;
export function startSession(): Promise<ClientSession>;
export function isValidObjectId(value: unknown): boolean;

export interface Mongoose {
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
}

declare const mongoose: Mongoose;
export default mongoose;
