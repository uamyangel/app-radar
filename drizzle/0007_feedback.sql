CREATE TABLE "feedback" (
	"need_id" bigint NOT NULL,
	"country" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"metrics_snapshot" jsonb,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feedback_need_id_country_pk" PRIMARY KEY("need_id","country")
);
