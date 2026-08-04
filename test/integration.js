"use strict";

const assert = require("assert/strict");
const database = require("..");

async function main() {
  process.env.PG_DOCUMENT_NAMESPACE = process.env.PG_DOCUMENT_NAMESPACE || `smoke_${Date.now()}`;
  await database.connect();

  const schema = new database.Schema(
    {
      email: { type: String, required: true, lowercase: true, trim: true },
      balance: { type: String, default: "0" },
      tags: [String],
      expiresAt: Date
    },
    { timestamps: true, collection: "adapter_smoke" }
  );

  const Account = database.model("AdapterSmoke", schema);
  await Account.deleteMany({});
  const account = await Account.create({
    email: "  TEST@EXAMPLE.COM ",
    balance: "10",
    expiresAt: new Date(Date.now() + 60_000)
  });

  assert.equal(account.email, "test@example.com");
  assert.deepEqual(account.tags, []);

  const found = await Account.findOne({ email: "test@example.com" });
  assert.equal(found.id, account.id);

  await Account.updateOne(
    { _id: account._id },
    { $inc: { balance: "5" }, $addToSet: { tags: "verified" } }
  );
  const updated = await Account.findById(account._id).lean();
  assert.equal(updated.balance, "15");
  assert.deepEqual(updated.tags, ["verified"]);

  const session = await database.startSession();
  await session.withTransaction(async () => {
    await Account.create([{ email: "second@example.com" }], { session });
    await Account.updateOne(
      { email: "second@example.com" },
      { $set: { balance: "7" } },
      { session }
    );
  });
  await session.endSession();

  const grouped = await Account.aggregate([
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);
  assert.equal(grouped[0].count, 2);

  const stringIdSchema = new database.Schema(
    {
      _id: { type: String, required: true },
      status: { type: String, required: true }
    },
    { collection: "adapter_string_ids" }
  );
  const StringIdRecord = database.model("AdapterStringId", stringIdSchema);
  await StringIdRecord.deleteMany({});

  const quoteDerivedId = "swap_crypto_user_quote:q_1785784765074_d901f1ce:request";
  await StringIdRecord.updateOne(
    { _id: quoteDerivedId },
    { $setOnInsert: { status: "queued" } },
    { upsert: true }
  );
  const stringIdRecord = await StringIdRecord.findById(quoteDerivedId).lean();
  assert.equal(stringIdRecord._id, quoteDerivedId);
  assert.equal(stringIdRecord.status, "queued");

  await Account.deleteMany({});
  await StringIdRecord.deleteMany({});
  assert.equal(await Account.countDocuments({}), 0);
  await database.disconnect();
  console.log("PostgreSQL adapter integration smoke passed");
}

main().catch(async (error) => {
  console.error(error);
  await database.disconnect().catch(() => undefined);
  process.exit(1);
});
