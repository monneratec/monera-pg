"use strict";

const assert = require("assert/strict");
const mongoose = require("..");

async function main() {
  process.env.PG_DOCUMENT_NAMESPACE = process.env.PG_DOCUMENT_NAMESPACE || `smoke_${Date.now()}`;
  await mongoose.connect();

  const schema = new mongoose.Schema(
    {
      email: { type: String, required: true, lowercase: true, trim: true },
      balance: { type: String, default: "0" },
      tags: [String],
      expiresAt: Date
    },
    { timestamps: true, collection: "adapter_smoke" }
  );

  const Account = mongoose.model("AdapterSmoke", schema);
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

  const session = await mongoose.startSession();
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

  await Account.deleteMany({});
  assert.equal(await Account.countDocuments({}), 0);
  await mongoose.disconnect();
  console.log("PostgreSQL adapter integration smoke passed");
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
