CREATE TABLE "relay_bot_attention_receipts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "payload_json" text NOT NULL,
  "claimed_at" varchar(64) NOT NULL,
  "delivered_at" varchar(64)
);
