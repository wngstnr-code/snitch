CREATE TABLE "attestations" (
	"uid" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"schema_uid" text NOT NULL,
	"tx_hash" text NOT NULL,
	"attester" text NOT NULL,
	"verdict" text NOT NULL,
	"confidence" integer NOT NULL,
	"evidence_hash" text NOT NULL,
	"evidence_uri" text NOT NULL,
	"evidence_as_of" timestamp with time zone NOT NULL,
	"attested_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_tx_hash" text,
	"revoke_reason" text,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"geojson" jsonb NOT NULL,
	"geohash" text NOT NULL,
	"area_ha" double precision NOT NULL,
	"operator_name" text NOT NULL,
	"source" text NOT NULL,
	"mill_uml_id" text,
	"mill_rspo_status_uml" text,
	"mill_rspo_certified_unilever" boolean,
	"mill_rspo_type" text,
	"mill_parent_company" text,
	"mill_country" text,
	"lat" double precision,
	"lon" double precision,
	"sourcing_radius_m" integer,
	"dataset_source_url" text,
	"dataset_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_log" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"decision" text NOT NULL,
	"override_verdict" text,
	"reason" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"list" text NOT NULL,
	"entry_id" text NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"entity_type" text,
	"programs" text,
	"country" text,
	"list_date" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"plot_id" text NOT NULL,
	"status" text NOT NULL,
	"evidence_as_of" timestamp with time zone NOT NULL,
	"bundle_id" text,
	"bundle_hash" text,
	"bundle_blob_url" text,
	"assessment" jsonb,
	"review" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"checked" integer DEFAULT 0 NOT NULL,
	"revoked_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"trigger" text NOT NULL,
	"duration_s" real
);
--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attestations_verification_idx" ON "attestations" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "attestations_revoked_idx" ON "attestations" USING btree ("revoked");--> statement-breakpoint
CREATE INDEX "evidence_items_verification_idx" ON "evidence_items" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "evidence_items_kind_idx" ON "evidence_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "plots_source_idx" ON "plots" USING btree ("source");--> statement-breakpoint
CREATE INDEX "plots_geohash_idx" ON "plots" USING btree ("geohash");--> statement-breakpoint
CREATE INDEX "plots_mill_uml_id_idx" ON "plots" USING btree ("mill_uml_id");--> statement-breakpoint
CREATE INDEX "review_log_verification_idx" ON "review_log" USING btree ("verification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sanctions_list_entry_uq" ON "sanctions_entries" USING btree ("list","entry_id");--> statement-breakpoint
CREATE INDEX "sanctions_name_norm_idx" ON "sanctions_entries" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_plot_idx" ON "verifications" USING btree ("plot_id");