/**
 * Every content hash each released migration file has ever had, oldest first.
 *
 * The ledger stores the sha256 of the migration file, so a released file that
 * changes by even one comment byte makes every database that already applied
 * the original look like tampered history and stops the service from starting.
 * This table is the single record of that history: the last hash of each entry
 * is the file as it stands now, and everything before it is a revision some
 * database may still have recorded as applied.
 *
 * Two invariants are enforced by migrationState.test.ts, and together they make
 * an unrecorded edit impossible to ship: the last hash of every entry must match
 * the file on disk, so editing a released migration fails the suite until the
 * new hash is appended — and appending it turns the previous hash into a
 * superseded revision, which is exactly what isSupersededMigrationHash() reads.
 * There is no second list to keep in sync.
 *
 * A revision may only be retired here when the corrected file is provably
 * equivalent on every database where the original succeeded, so accepting the
 * old hash cannot hide real divergence:
 *
 * 0004 created its indexes without IF NOT EXISTS. Wherever the original
 * succeeded the indexes did not yet exist, so adding the guard produces the
 * same two indexes by the same definitions.
 *
 * 0005 created its unique indexes without first removing the duplicate rows
 * that made them fail on live data. Wherever the original succeeded there were
 * no duplicates, so the de-duplication added to the corrected file deletes
 * nothing and both versions leave exactly the same schema and rows.
 *
 * 0018 packed two statements into one file without the `--> statement-breakpoint`
 * separator every other multi-statement migration uses, and wrote the index
 * columns with spaces after the commas. Both are purely textual: the runner
 * executes the same ALTER TABLE and CREATE INDEX in the same order either way,
 * and `("a", "b")` and `("a","b")` are the same index to PostgreSQL. The
 * correction only lets the bridge compare the file against a generated drift
 * plan, which emits neither the separator nor the spaces.
 *
 * 0023 wrote its partial index predicate with a bare column name
 * (`WHERE land_state = 'pending'`) while every other partial index in the tree
 * qualifies it (`WHERE "assets"."land_state" = 'pending'`, as 0001 does and as
 * the generated drift plan emits). PostgreSQL resolves both to the same
 * predicate on the same index — the correction only lets the bridge match the
 * file against the drift plan textually.
 *
 * 0025 created the props table without the owner_kind/owner_id columns, which
 * 0029 then added. Both are in the same bridge batch, and the bridge compares a
 * table created inside that batch against the drift plan whole-table DDL — so
 * the columns had to move into 0025 CREATE TABLE (the rule 0022 already
 * records). 0029 keeps the guarded ALTERs for databases that applied the
 * original 0025, so both orders converge on the same table; wherever the
 * original succeeded, re-running the corrected file creates the same table with
 * the columns 0029 would have added anyway.
 *
 * 0029 only gained comment lines when 0025 was corrected — its three statements
 * are byte-identical. Comments never reach PostgreSQL, and the gates downstream
 * strip them before comparing, so the corrected file applies exactly what the
 * original did. The hash is taken over the raw file, though, so the deployed
 * databases that had already applied 0029 read as tampered until this revision
 * was recorded.
 *
 * 0032 repeated 0023's mistake in one of its five index predicates: the partial
 * unique index qualified `"community_posts"."status"` but left `source_id` bare
 * (`WHERE "source_id" is not null and …`), while the generated drift plan
 * qualifies both. Inside a partial index on community_posts an unqualified
 * source_id can only resolve to that table's column, so PostgreSQL stores the
 * identical predicate either way — every database that applied the original
 * carries exactly the index the corrected file creates. The correction only
 * lets the bridge match the file against the drift plan textually.
 *
 * 0035 originally used a composite primary key on (post_id, user_id). That
 * shape makes drizzle-kit 0.31's introspect path throw DrizzleQueryError on
 * `SELECT conname AS primary_key …` (drizzle-kit#5557), which aborted every
 * boot after ledger ready. The corrected file creates a surrogate uuid PK plus
 * unique(post_id, user_id). Databases that already applied the original still
 * carry the composite PK until 0036 rewrites them; accepting the original hash
 * only prevents a false "tampered history" reading — it does not claim the two
 * files produce identical schemas on their own.
 */
export const MIGRATION_REVISIONS: Readonly<Record<string, readonly string[]>> = {
  "0000_0000_baseline": [
    "512caacaa233ba3536f9efefc9494c44296472ad236b4efccd24123f24b19d2a",
  ],
  "0001_managed_indexes": [
    "934ac83bc470e85a1413e39c968d3e3e8125792c92bb1d97eeda131a9bf56766",
  ],
  "0002_distributed_rate_limits": [
    "d1c7f4efe9a560b57062dae4ef3971a3e631ce30437b875fb61bf9cc6bf07972",
  ],
  "0003_idempotency_records": [
    "51c1ba8ca91a7764617195283dadb2ac588efe18fcae5ddfe5551543501c30eb",
  ],
  "0004_query_indexes": [
    "8ce681fac43c4f65210542bd0f775ff49b30967b4188953a54795755b9e9f1cf",
    "e90b0029adafdfc7b2d44fe2a449b108671d1520c6ce90e026e4bdf509fac87d",
  ],
  "0005_membership_read_uniqueness": [
    "30b344a7e264c48e4b62af11cb689da353b7f4846f6374a0d33f27aa38cc1337",
    "21ca01a3956fa7dbb082fd8f7a3a06d5fc6f962dc598abdebaf73b8d8e11c093",
  ],
  "0006_agent_plan_effects": [
    "c3f5edffbe57cc145d381e3773465125a3c5839b59a78fcc745bce8958acf893",
  ],
  "0007_project_human_tasks": [
    "dbdf686d065d61404528c7f87da940cd3cc911f5cdf169b59f11718f87459376",
  ],
  "0008_complete_plan_summary": [
    "f5b2f9a3a45de08131570fbd31c265408ca8bd659f53a0eb50041474aa826974",
  ],
  "0009_agent_events_and_indexes": [
    "3211433f7a27a67e8bc8288bb5bf189576c67b594f0d787e0aba0bb293337143",
  ],
  "0010_model_live_catalog": [
    "f93e0251e56532aba0600ba0a352e6bae3232d2b50d9f360b29c4d06536264b6",
  ],
  "0011_agent_planner_telemetry": [
    "9b16ef3820e0af451c8f3d4698b349d26f8da787e3d7f5ad97a16fca72f572eb",
  ],
  "0012_session_device_meta": [
    "c8c249da1a69c12b149d6819445004a138790c3dadfa818b5744c014670de6d0",
  ],
  "0013_upload_grants": [
    "2ea46dbeec8d85b0a102831e630361302ec6d20e62e178a1883a11e969f8ac0a",
  ],
  "0014_email_step_up": [
    "2966ccc48ea92420147bc6cc059b60e6930817f847518785a5afcfbf9c48cbc6",
  ],
  "0015_ui_density": [
    "9635985869b7df80812d4aa451f67c70db96225b58c3838430e4738db2177dc8",
  ],
  "0016_external_accounts": [
    "45ad96f102a5de8bbfca95d4152d11c63b5e10c6d4bf1cb3d04f8c86d95079e9",
  ],
  "0017_group_agent_overview_idx": [
    "48721bf7f56f2ebec4480579bec0f129c0757eb4cc51cd2d2ad3acbfe92f137b",
  ],
  "0018_knowledge_pinned": [
    "cddbd89830cce4850f83515692724cb507a4c52afc28941633fc1f882e907e82",
    "fd8326908d1653a59be83fa40186c253fb7573bda8f4d64ff3b5a9bd6d82f50e",
  ],
  "0019_knowledge_summary": [
    "be6e8ba8516492edcc074da4a80e0a59bae17af89dc41e1c7672dd5881b44a6e",
  ],
  "0020_group_agent_commander": [
    "8725f29b54d771937631741929b13d76d723f87f9420e8c7d74a949956e7aff0",
  ],
  "0021_user_presence": [
    "078aa7549e93a87b44add399d45e3bbd1007ebe79c92128557bed0d7c3c4f1ec",
  ],
  "0022_device_trust": [
    "34765cf6a6199b3dd1a3aa5f45a72b9b88026a57a40fc714d6eda67632c4eb37",
  ],
  "0023_asset_durability": [
    "150e3024f1830ef05f65469164b99e3b5f33199408802ff7df125faef71679e5",
    "c8f21bd2a284a38b7dd235b4af3a203b35c7ed88cb335575e45e160e72d9b5aa",
  ],
  "0024_asset_revisions": [
    "f6b39737f18ffb991acfdc79a89c16b65db0874b6be5c52b19bdd5f708d5d962",
  ],
  "0025_project_props": [
    "d93eaefc4613d71f61a3b31a8cb7620ad4080d4c495c103047486a1cc2d4a01a",
    "6a0c632b7752aa41da7ce17f679043241b84c280033f87ea15ebfc39dff569a4",
  ],
  "0026_ai_trace": [
    "e0c72e1b44bc9b68bb39bc2e7b84c279d98d620ca32e7a8f3c1a2ee57b7a58b7",
  ],
  "0027_generation_continuity": [
    "111a7946faa6b9d8ef505994f5275fcc56aae69433974e2d59951688e9bf75d4",
  ],
  "0028_workflow_continuity_snapshot": [
    "2d366a0ff4b0f7e6c58226aba07ad97a1d0d90d955a85a63fe543dc2050cda58",
  ],
  "0029_prop_ownership": [
    "ec2496a3bce3cd11dcf1a4d3b9f65af51e52b2695defb38f5ffefe8a88343083",
    "c6381d8592f13a9cfa57f2d2a800b214933429a1114b04d39973fadf3fcae8ed",
  ],
  "0030_scene_cards": [
    "7838aa34020fe29cafddb677ee6d1b6e0b5e94a4ad02adb4687c8190663ee4d1",
  ],
  "0031_user_ai_provider_keys": [
    "e241845d0ddbed3b15dde705fb01befce587d9211b4e1e16b7e168c9c4c6f246",
    "e5bd470f34812bc816497130bb141a4612c72f3d186983055701f93ba086ba89",
    "e3e1618e5d97c7e3b0af18939a83bd3b260df26bea65fa961853bcb4e1ea1e9e",
  ],
  "0032_community_posts": [
    "ea558827804441655f3c8827770490eb34fbb6d2d597187a8911a45d4d1996c8",
    "f2c1ea2a71b114dc3ca6f69c63bfe28aadfb83d5dfc0f464cd81ee74ae3936f8",
    "72dfa8e1cdca1d2b5be188f41b7af4abafdb504ee2ebfdd0055e1ffff6231796",
  ],
  "0033_user_avatar": [
    "336a82ba3e08d65d7c80736cabdbe328d09ddadcd024de74b7f7ca23cd42c5db",
  ],
  "0034_note_comments": [
    "d2554f1ce2f5d4ab89cc31291ba7b0dc88b2fe5978524945945cacd995bc55a9",
  ],
  // 0035：初版為 composite PK (post_id,user_id)。為避開 drizzle-kit#5557 introspection
  // 崩潰改為 surrogate uuid PK + unique(post_id,user_id)。已套用初版的 DB 由 0036 前向升級；
  // 初版 hash 仍被 isSupersededMigrationHash 接受，避免 ledger 誤判為被竄改。
  "0035_community_likes": [
    "0e67b32f2c9fdaa5d3ae9b77575686a532b4f7788090f775a8aef6ec6ad2ff96",
    "f19f584db2351a32c9c3eb5de9d25bd6bba558cee2b49bd2b0b1c0d12efd0acc",
  ],
  // 0036：僅服務「已套用舊 0035 composite PK」的 DB；新 0035 上 DROP+ADD pkey 等價重套。
  // 含 DROP/ADD PRIMARY KEY，不可納入 LEGACY_ADOPTION_PENDING_TAGS。
  // 初版（#397）無 DROP pkey 步驟；已套用初版者 schema 已是最終形狀。
  "0036_community_likes_surrogate_pk": [
    "a4e9cd69527f5daae8c3b78036a5e51c0b3ef6a09f97c69df35e79ab6be470ed",
    "8677baa3b1c8e65bddb0b2008392713d68c673ff4fc3e922b0809e3bdca845d3",
  ],
  "0037_project_cover": [
    "0b5a6642a026bbb0f54e9243baad79a964725e785de53e77e4194a51461d6f88",
  ],
};
