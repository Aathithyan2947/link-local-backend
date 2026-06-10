-- CreateTable
CREATE TABLE "cities" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "pincode" TEXT,
    "suburb" TEXT,
    "area_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_subcategories" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_subcategory_fields" (
    "id" SERIAL NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "field_options" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_subcategory_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_profile_custom_fields" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "field_id" INTEGER NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "sp_profile_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_master" (
    "id" SERIAL NOT NULL,
    "degree" TEXT,
    "school_name" TEXT,
    "school_city" TEXT,
    "college_name" TEXT,
    "college_city" TEXT,
    "post_grad_college" TEXT,
    "post_grad_city" TEXT,

    CONSTRAINT "education_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profession_master" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "profession_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hobbies_master" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hobbies_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "validity_from" DATE,
    "validity_to" DATE,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usage_log" (
    "id" SERIAL NOT NULL,
    "coupon_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_tags" (
    "id" SERIAL NOT NULL,
    "tag_name" TEXT NOT NULL,

    CONSTRAINT "profile_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_sources" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "referral_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freebies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points_required" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freebies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_referral_points" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "points_per_referral" INTEGER NOT NULL,
    "bonus_points_new_city" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_referral_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_allowed_doc_types" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "doc_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "city_allowed_doc_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "mobile" VARCHAR(15),
    "email" TEXT,
    "password_hash" TEXT,
    "auth_type" TEXT NOT NULL,
    "user_type" TEXT NOT NULL,
    "referral_code" TEXT,
    "referred_by" INTEGER,
    "referral_source_id" INTEGER,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_users" (
    "id" SERIAL NOT NULL,
    "blocker_id" INTEGER NOT NULL,
    "blocked_id" INTEGER NOT NULL,
    "reason" TEXT,
    "block_scope" TEXT NOT NULL DEFAULT 'full',
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "mobile" VARCHAR(15),
    "email" TEXT,
    "otp_code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "device_token" TEXT,
    "device_name" TEXT,
    "last_active_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "area_id" INTEGER NOT NULL,
    "flat_wing" TEXT,
    "apartment" TEXT,
    "lane1" TEXT,
    "lane2" TEXT,
    "full_address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_verification_docs" (
    "id" SERIAL NOT NULL,
    "address_id" INTEGER NOT NULL,
    "city_id" INTEGER NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_url" TEXT NOT NULL,
    "status" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_verification_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_circles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visibility_circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_circle_members" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visibility_circle_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_city_memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "city_id" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_city_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "photo_url" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "about_me" TEXT,
    "address_id" INTEGER,
    "ownership_type" TEXT,
    "residing_since" DATE,
    "can_offer_help_with" TEXT,
    "social_media_share_enabled" BOOLEAN NOT NULL DEFAULT false,
    "visibility_circle_id" INTEGER,
    "years_of_experience" INTEGER,
    "marketing_coupon_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_completion_tracking" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "has_photo" BOOLEAN NOT NULL DEFAULT false,
    "has_address" BOOLEAN NOT NULL DEFAULT false,
    "has_address_verified" BOOLEAN NOT NULL DEFAULT false,
    "has_education" BOOLEAN NOT NULL DEFAULT false,
    "has_profession" BOOLEAN NOT NULL DEFAULT false,
    "has_contact_details" BOOLEAN NOT NULL DEFAULT false,
    "has_service_types" BOOLEAN NOT NULL DEFAULT false,
    "has_products" BOOLEAN NOT NULL DEFAULT false,
    "has_delivery_prefs" BOOLEAN NOT NULL DEFAULT false,
    "has_payment_methods" BOOLEAN NOT NULL DEFAULT false,
    "completion_percent" INTEGER NOT NULL DEFAULT 0,
    "last_computed_at" TIMESTAMP(3),

    CONSTRAINT "profile_completion_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_privacy_settings" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "profile_visibility_circle_id" INTEGER,
    "search_visibility_circle_id" INTEGER,
    "name_visibility_circle_id" INTEGER,
    "age_visibility_circle_id" INTEGER,
    "gender_visibility_circle_id" INTEGER,
    "address_visibility_circle_id" INTEGER,
    "education_visibility_circle_id" INTEGER,
    "profession_visibility_circle_id" INTEGER,
    "contact_visibility_circle_id" INTEGER,
    "messaging_access_circle_id" INTEGER,
    "ratings_visibility_circle_id" INTEGER,

    CONSTRAINT "profile_privacy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_education" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "education_master_id" INTEGER,

    CONSTRAINT "profile_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_hobbies" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "hobby_master_id" INTEGER,
    "custom_hobby" TEXT,

    CONSTRAINT "profile_hobbies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_professions" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "profession_master_id" INTEGER,
    "company_or_detail" TEXT,

    CONSTRAINT "profile_professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_contact_details" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "contact_type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "visibility_circle_id" INTEGER,

    CONSTRAINT "profile_contact_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_tags_map" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "assigned_by" INTEGER,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_tags_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_pets" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "name" TEXT,
    "type" TEXT,
    "breed" TEXT,
    "photo_url" TEXT,
    "video_url" TEXT,
    "age" INTEGER,

    CONSTRAINT "profile_pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_family" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "related_user_id" INTEGER,
    "name" TEXT,

    CONSTRAINT "profile_family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_service_types" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "service_nature" TEXT NOT NULL,
    "frequency" TEXT,

    CONSTRAINT "profile_service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_media" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_products" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2),
    "unit" TEXT,
    "quantity" DECIMAL(10,3),
    "quantity_metric" TEXT,
    "customization_notes" TEXT,
    "photo_url" TEXT,
    "category" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sp_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_delivery_preferences" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "delivery_timing_type" TEXT,
    "offers_home_delivery" BOOLEAN NOT NULL DEFAULT false,
    "delivery_radius_km" DECIMAL(5,2),
    "min_order_amount" DECIMAL(10,2),
    "delivery_charge" DECIMAL(10,2),
    "delivery_time_minutes" INTEGER,
    "offers_pickup" BOOLEAN NOT NULL DEFAULT false,
    "pickup_address_id" INTEGER,
    "delivery_notes" TEXT,

    CONSTRAINT "sp_delivery_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_unavailability" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "unavailable_date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sp_unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_payment_methods" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "payment_type" TEXT NOT NULL,
    "upi_id" TEXT,
    "account_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sp_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_payment_terms" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "payment_terms" TEXT NOT NULL,
    "partial_advance_pct" DECIMAL(5,2),

    CONSTRAINT "sp_payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sp_schedule_slots" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "booked_by" INTEGER,
    "order_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sp_schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "post_type" TEXT NOT NULL,
    "text_content" TEXT,
    "sharing_allowed" BOOLEAN NOT NULL DEFAULT true,
    "visibility_circle_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "liked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "parent_comment_id" INTEGER,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comment_reactions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "reacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comment_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_shares" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_reposts" (
    "id" SERIAL NOT NULL,
    "original_post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reposted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_reposts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_removal_requests" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "duration_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_removal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_shares" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "sharing_channel" TEXT,
    "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" SERIAL NOT NULL,
    "reported_by" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "reported_user_id" INTEGER,
    "reason" TEXT,
    "status" TEXT,
    "reviewed_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "parent_event_id" INTEGER,
    "cloned_by" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photo_url" TEXT,
    "date" DATE NOT NULL,
    "start_time" TIME,
    "duration_minutes" INTEGER,
    "mode" TEXT NOT NULL,
    "location" TEXT,
    "online_link" TEXT,
    "visibility_circle_id" INTEGER,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(10,2),
    "max_attendees" INTEGER,
    "coupon_id" INTEGER,
    "eligibility_min_age" INTEGER,
    "eligibility_gender" TEXT,
    "admin_approval_needed" BOOLEAN NOT NULL DEFAULT false,
    "allow_cloning" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_raw_materials" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "material" TEXT NOT NULL,

    CONSTRAINT "event_raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attendees" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "payment_status" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_ratings" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "parent_event_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "rating" INTEGER,
    "review" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_payments" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "coupon_id" INTEGER,
    "discount_applied" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL,
    "transaction_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_invited_users" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "invited_user_id" INTEGER NOT NULL,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,

    CONSTRAINT "event_invited_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deletion_requests" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_groups" (
    "id" SERIAL NOT NULL,
    "creator_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photo_url" TEXT,
    "duration_days" INTEGER,
    "validity_from" DATE,
    "validity_to" DATE,
    "visibility_circle_id" INTEGER,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(10,2),
    "coupon_id" INTEGER,
    "max_members" INTEGER,
    "eligibility_min_age" INTEGER,
    "eligibility_gender" TEXT,
    "admin_approval_needed" BOOLEAN NOT NULL DEFAULT false,
    "multiple_admins_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_admins" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "is_creator" BOOLEAN NOT NULL DEFAULT false,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_group_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_members" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "payment_status" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_payments" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "coupon_id" INTEGER,
    "discount_applied" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL,
    "transaction_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_group_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_posts" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "post_id" INTEGER NOT NULL,

    CONSTRAINT "interest_group_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_ratings" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "rating" INTEGER,
    "review" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_group_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_invited_users" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "invited_user_id" INTEGER NOT NULL,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,

    CONSTRAINT "interest_group_invited_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_group_ownership_transfers" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "transferred_from" INTEGER NOT NULL,
    "transferred_to" INTEGER NOT NULL,
    "transfer_reason" TEXT,
    "initiated_by" INTEGER,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_group_ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" SERIAL NOT NULL,
    "referrer_id" INTEGER NOT NULL,
    "referred_user_id" INTEGER,
    "referral_source_id" INTEGER,
    "event_id" INTEGER,
    "city_id" INTEGER,
    "sharing_channel" TEXT,
    "status" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3),
    "points_credited" INTEGER NOT NULL DEFAULT 0,
    "points_credited_at" TIMESTAMP(3),
    "points_expires_at" TIMESTAMP(3),
    "redeemed_against_freebie_id" INTEGER,
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_daily_caps" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "cap_date" DATE NOT NULL,
    "referrals_sent" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_daily_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "receiver_id" INTEGER NOT NULL,
    "message_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" INTEGER,
    "enquiry_status" TEXT,
    "conversation_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted_by_sender" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted_by_receiver" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_provider_ratings" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "rated_by" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "review" TEXT,
    "area_context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_provider_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "query" TEXT NOT NULL,
    "filters" JSONB,
    "results_count" INTEGER,
    "result_entity_type" TEXT,
    "result_entity_id" INTEGER,
    "searched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_verifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reviewed_by" INTEGER,
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitelisted_blacklisted_users" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "set_by" INTEGER,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whitelisted_blacklisted_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_emails" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "to_user_id" INTEGER,
    "reply_to_email_id" INTEGER,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "email_tag" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions_master" (
    "id" SERIAL NOT NULL,
    "user_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "is_allowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "permissions_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" INTEGER,
    "details" JSONB,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "buyer_id" INTEGER NOT NULL,
    "sp_profile_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "delivery_type" TEXT,
    "delivery_address_id" INTEGER,
    "scheduled_slot_id" INTEGER,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "delivery_charge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_applied" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "coupon_id" INTEGER,
    "special_instructions" TEXT,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "customization_notes" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_type" TEXT NOT NULL,
    "payment_method" TEXT,
    "payment_status" TEXT NOT NULL,
    "transaction_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" SERIAL NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "amount_requested" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "refund_processed_at" TIMESTAMP(3),
    "refund_amount" DECIMAL(10,2),
    "transaction_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "notification_type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" INTEGER,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_pushed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "services_availed" INTEGER NOT NULL DEFAULT 0,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "replies_pending" INTEGER NOT NULL DEFAULT 0,
    "posts_made" INTEGER NOT NULL DEFAULT 0,
    "events_hosted" INTEGER NOT NULL DEFAULT 0,
    "groups_part_of" INTEGER NOT NULL DEFAULT 0,
    "referral_points_balance" INTEGER NOT NULL DEFAULT 0,
    "leads_received" INTEGER NOT NULL DEFAULT 0,
    "leads_rejected" INTEGER NOT NULL DEFAULT 0,
    "orders_received" INTEGER NOT NULL DEFAULT 0,
    "payment_received_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hobbies_master_name_key" ON "hobbies_master"("name");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_codes_code_key" ON "coupon_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "profile_tags_tag_name_key" ON "profile_tags"("tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_city_memberships_user_id_city_id_key" ON "user_city_memberships"("user_id", "city_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_completion_tracking_profile_id_key" ON "profile_completion_tracking"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_privacy_settings_profile_id_key" ON "profile_privacy_settings"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "sp_delivery_preferences_profile_id_key" ON "sp_delivery_preferences"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "sp_payment_terms_profile_id_key" ON "sp_payment_terms"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_daily_caps_user_id_cap_date_key" ON "referral_daily_caps"("user_id", "cap_date");

-- CreateIndex
CREATE UNIQUE INDEX "user_stats_user_id_key" ON "user_stats"("user_id");

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_subcategories" ADD CONSTRAINT "service_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_subcategory_fields" ADD CONSTRAINT "service_subcategory_fields_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "service_subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_profile_custom_fields" ADD CONSTRAINT "sp_profile_custom_fields_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_profile_custom_fields" ADD CONSTRAINT "sp_profile_custom_fields_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "service_subcategory_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "coupon_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage_log" ADD CONSTRAINT "coupon_usage_log_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage_log" ADD CONSTRAINT "coupon_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_referral_points" ADD CONSTRAINT "city_referral_points_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_referral_points" ADD CONSTRAINT "city_referral_points_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_allowed_doc_types" ADD CONSTRAINT "city_allowed_doc_types_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referral_source_id_fkey" FOREIGN KEY ("referral_source_id") REFERENCES "referral_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_tokens" ADD CONSTRAINT "otp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_verification_docs" ADD CONSTRAINT "address_verification_docs_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_verification_docs" ADD CONSTRAINT "address_verification_docs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_verification_docs" ADD CONSTRAINT "address_verification_docs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visibility_circles" ADD CONSTRAINT "visibility_circles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visibility_circle_members" ADD CONSTRAINT "visibility_circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "visibility_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visibility_circle_members" ADD CONSTRAINT "visibility_circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_city_memberships" ADD CONSTRAINT "user_city_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_city_memberships" ADD CONSTRAINT "user_city_memberships_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_visibility_circle_id_fkey" FOREIGN KEY ("visibility_circle_id") REFERENCES "visibility_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_marketing_coupon_id_fkey" FOREIGN KEY ("marketing_coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_completion_tracking" ADD CONSTRAINT "profile_completion_tracking_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_privacy_settings" ADD CONSTRAINT "profile_privacy_settings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_education_master_id_fkey" FOREIGN KEY ("education_master_id") REFERENCES "education_master"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_hobbies" ADD CONSTRAINT "profile_hobbies_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_hobbies" ADD CONSTRAINT "profile_hobbies_hobby_master_id_fkey" FOREIGN KEY ("hobby_master_id") REFERENCES "hobbies_master"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_professions" ADD CONSTRAINT "profile_professions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_professions" ADD CONSTRAINT "profile_professions_profession_master_id_fkey" FOREIGN KEY ("profession_master_id") REFERENCES "profession_master"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_contact_details" ADD CONSTRAINT "profile_contact_details_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_contact_details" ADD CONSTRAINT "profile_contact_details_visibility_circle_id_fkey" FOREIGN KEY ("visibility_circle_id") REFERENCES "visibility_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_tags_map" ADD CONSTRAINT "profile_tags_map_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_tags_map" ADD CONSTRAINT "profile_tags_map_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "profile_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_tags_map" ADD CONSTRAINT "profile_tags_map_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_pets" ADD CONSTRAINT "profile_pets_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_family" ADD CONSTRAINT "profile_family_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_family" ADD CONSTRAINT "profile_family_related_user_id_fkey" FOREIGN KEY ("related_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_service_types" ADD CONSTRAINT "profile_service_types_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_service_types" ADD CONSTRAINT "profile_service_types_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "service_subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_media" ADD CONSTRAINT "profile_media_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_products" ADD CONSTRAINT "sp_products_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_delivery_preferences" ADD CONSTRAINT "sp_delivery_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_delivery_preferences" ADD CONSTRAINT "sp_delivery_preferences_pickup_address_id_fkey" FOREIGN KEY ("pickup_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_unavailability" ADD CONSTRAINT "sp_unavailability_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_payment_methods" ADD CONSTRAINT "sp_payment_methods_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_payment_terms" ADD CONSTRAINT "sp_payment_terms_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_schedule_slots" ADD CONSTRAINT "sp_schedule_slots_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_schedule_slots" ADD CONSTRAINT "sp_schedule_slots_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sp_schedule_slots" ADD CONSTRAINT "sp_schedule_slots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_visibility_circle_id_fkey" FOREIGN KEY ("visibility_circle_id") REFERENCES "visibility_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "post_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment_reactions" ADD CONSTRAINT "post_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_shares" ADD CONSTRAINT "post_shares_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_shares" ADD CONSTRAINT "post_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reposts" ADD CONSTRAINT "post_reposts_original_post_id_fkey" FOREIGN KEY ("original_post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reposts" ADD CONSTRAINT "post_reposts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_removal_requests" ADD CONSTRAINT "feed_removal_requests_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_removal_requests" ADD CONSTRAINT "feed_removal_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_shares" ADD CONSTRAINT "entity_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_cloned_by_fkey" FOREIGN KEY ("cloned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_visibility_circle_id_fkey" FOREIGN KEY ("visibility_circle_id") REFERENCES "visibility_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_raw_materials" ADD CONSTRAINT "event_raw_materials_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ratings" ADD CONSTRAINT "event_ratings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ratings" ADD CONSTRAINT "event_ratings_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ratings" ADD CONSTRAINT "event_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payments" ADD CONSTRAINT "event_payments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payments" ADD CONSTRAINT "event_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payments" ADD CONSTRAINT "event_payments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invited_users" ADD CONSTRAINT "event_invited_users_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invited_users" ADD CONSTRAINT "event_invited_users_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deletion_requests" ADD CONSTRAINT "event_deletion_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_groups" ADD CONSTRAINT "interest_groups_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_groups" ADD CONSTRAINT "interest_groups_visibility_circle_id_fkey" FOREIGN KEY ("visibility_circle_id") REFERENCES "visibility_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_groups" ADD CONSTRAINT "interest_groups_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_admins" ADD CONSTRAINT "interest_group_admins_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_admins" ADD CONSTRAINT "interest_group_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_members" ADD CONSTRAINT "interest_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_members" ADD CONSTRAINT "interest_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_payments" ADD CONSTRAINT "interest_group_payments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_payments" ADD CONSTRAINT "interest_group_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_payments" ADD CONSTRAINT "interest_group_payments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_posts" ADD CONSTRAINT "interest_group_posts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_posts" ADD CONSTRAINT "interest_group_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ratings" ADD CONSTRAINT "interest_group_ratings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ratings" ADD CONSTRAINT "interest_group_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_invited_users" ADD CONSTRAINT "interest_group_invited_users_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_invited_users" ADD CONSTRAINT "interest_group_invited_users_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ownership_transfers" ADD CONSTRAINT "interest_group_ownership_transfers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "interest_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ownership_transfers" ADD CONSTRAINT "interest_group_ownership_transfers_transferred_from_fkey" FOREIGN KEY ("transferred_from") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ownership_transfers" ADD CONSTRAINT "interest_group_ownership_transfers_transferred_to_fkey" FOREIGN KEY ("transferred_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_group_ownership_transfers" ADD CONSTRAINT "interest_group_ownership_transfers_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_source_id_fkey" FOREIGN KEY ("referral_source_id") REFERENCES "referral_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_redeemed_against_freebie_id_fkey" FOREIGN KEY ("redeemed_against_freebie_id") REFERENCES "freebies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_daily_caps" ADD CONSTRAINT "referral_daily_caps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_provider_ratings" ADD CONSTRAINT "service_provider_ratings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_provider_ratings" ADD CONSTRAINT "service_provider_ratings_rated_by_fkey" FOREIGN KEY ("rated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_verifications" ADD CONSTRAINT "profile_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_verifications" ADD CONSTRAINT "profile_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitelisted_blacklisted_users" ADD CONSTRAINT "whitelisted_blacklisted_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whitelisted_blacklisted_users" ADD CONSTRAINT "whitelisted_blacklisted_users_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_emails" ADD CONSTRAINT "admin_emails_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_emails" ADD CONSTRAINT "admin_emails_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_emails" ADD CONSTRAINT "admin_emails_reply_to_email_id_fkey" FOREIGN KEY ("reply_to_email_id") REFERENCES "admin_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sp_profile_id_fkey" FOREIGN KEY ("sp_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_address_id_fkey" FOREIGN KEY ("delivery_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_scheduled_slot_id_fkey" FOREIGN KEY ("scheduled_slot_id") REFERENCES "sp_schedule_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "sp_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
