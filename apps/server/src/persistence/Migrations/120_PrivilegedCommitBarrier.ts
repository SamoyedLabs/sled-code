import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { privilegedCommitBarrierSql } from "../PrivilegedCommitBarrierSql.ts";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of privilegedCommitBarrierSql) yield* sql.unsafe(statement);
});
