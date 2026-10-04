CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text" text NOT NULL,
	"mood" integer,
	"energy" integer,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"title" text NOT NULL,
	"starts_at_utc" timestamp with time zone,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"org" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_url" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"account_id" text NOT NULL,
	"day" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text NOT NULL,
	"category_id" text,
	"pending" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_days" (
	"habit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"completed" boolean DEFAULT true NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "habit_days_habit_id_day_pk" PRIMARY KEY("habit_id","day")
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source_record_id" text NOT NULL,
	"data_origin" text NOT NULL,
	"steps" integer,
	"active_min" integer,
	"resting_hr" integer,
	"hrv_rmssd" real,
	"spo2" real,
	"respiratory_rate" real,
	"sleep_total_min" integer,
	"sleep_deep_min" integer,
	"sleep_rem_min" integer,
	"sleep_light_min" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source_record_id" text NOT NULL,
	"data_origin" text NOT NULL,
	"activity" text NOT NULL,
	"started_at_utc" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"active_min" integer,
	"energy_kcal" real,
	"distance_m" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentor_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mentor_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text" text NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"mentor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sport_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"minutes" integer NOT NULL,
	"load_score" integer,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strength_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strength_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reps" integer NOT NULL,
	"kg" real NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weight_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kg" real NOT NULL,
	"body_fat_pct" real,
	"client_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_connections" ADD CONSTRAINT "finance_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_days" ADD CONSTRAINT "habit_days_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_days" ADD CONSTRAINT "habit_days_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_daily" ADD CONSTRAINT "health_daily_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_chats" ADD CONSTRAINT "mentor_chats_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_turns" ADD CONSTRAINT "mentor_turns_chat_id_mentor_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."mentor_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_turns" ADD CONSTRAINT "mentor_turns_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_sessions" ADD CONSTRAINT "sport_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_exercises" ADD CONSTRAINT "strength_exercises_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_exercise_id_strength_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."strength_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_log" ADD CONSTRAINT "weight_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_user_client_idx" ON "checkins" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "checkins_user_day_idx" ON "checkins" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "events_user_day_idx" ON "events" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_idx" ON "finance_accounts" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_tx_source_idx" ON "finance_transactions" USING btree ("user_id","account_id","source_id");--> statement-breakpoint
CREATE INDEX "finance_tx_user_day_idx" ON "finance_transactions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "habit_days_user_day_idx" ON "habit_days" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "habits_user_client_idx" ON "habits" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "habits_user_idx" ON "habits" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_daily_source_idx" ON "health_daily" USING btree ("user_id","source_record_id");--> statement-breakpoint
CREATE INDEX "health_daily_user_day_idx" ON "health_daily" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "health_sessions_source_idx" ON "health_sessions" USING btree ("user_id","source_record_id");--> statement-breakpoint
CREATE INDEX "health_sessions_user_day_idx" ON "health_sessions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "mentor_chats_user_idx" ON "mentor_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mentor_turns_chat_idx" ON "mentor_turns" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_client_idx" ON "notes" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "notes_user_day_idx" ON "notes" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "profiles_updated_at_idx" ON "profiles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "sport_sessions_user_day_idx" ON "sport_sessions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "strength_exercises_user_day_idx" ON "strength_exercises" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "strength_sets_user_idx" ON "strength_sets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_client_idx" ON "tasks" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "tasks_user_day_idx" ON "tasks" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_log_user_client_idx" ON "weight_log" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "weight_log_user_day_idx" ON "weight_log" USING btree ("user_id","day");