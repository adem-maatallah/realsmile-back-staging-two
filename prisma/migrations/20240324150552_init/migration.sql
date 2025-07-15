-- CreateTable
CREATE TABLE `gamifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `express_credits` INTEGER NOT NULL,
    `standard_credits` INTEGER NOT NULL,
    `advanced_credits` INTEGER NOT NULL,
    `silver_yearly_credits` INTEGER NOT NULL,
    `gold_yearly_credits` INTEGER NOT NULL,
    `platinum_yearly_credits` INTEGER NOT NULL,
    `silver_second_year_credits` INTEGER NOT NULL,
    `gold_second_year_credits` INTEGER NOT NULL,
    `platinum_second_year_credits` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `grade` VARCHAR(50) NULL,
    `credits` INTEGER NOT NULL DEFAULT 0,
    `last_year_date` DATE NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `case_id` BIGINT NOT NULL,
    `patient_id` BIGINT NOT NULL,
    `invoice_id` VARCHAR(100) NOT NULL,
    `invoice_type` VARCHAR(200) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `code` VARCHAR(100) NOT NULL,
    `status` VARCHAR(100) NULL,
    `payment_status` ENUM('pending', 'complete', 'failed') NOT NULL DEFAULT 'pending',
    `invoice_link` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `temp_store` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_files` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `patient_id` BIGINT NOT NULL,
    `case_id` BIGINT NOT NULL,
    `image1` VARCHAR(255) NULL,
    `image2` VARCHAR(90) NULL,
    `image3` VARCHAR(90) NULL,
    `image4` VARCHAR(90) NULL,
    `image5` VARCHAR(90) NULL,
    `image6` VARCHAR(90) NULL,
    `image7` VARCHAR(90) NULL,
    `image8` VARCHAR(90) NULL,
    `image9` VARCHAR(255) NULL,
    `image10` VARCHAR(255) NULL,
    `aligner_number` TINYINT NOT NULL DEFAULT 1,
    `prescription_pdf` VARCHAR(150) NULL,
    `design_instruction` TEXT NULL,
    `medit_files` VARCHAR(200) NULL,
    `shape_files` VARCHAR(255) NULL,
    `custom_files` VARCHAR(255) NULL,
    `custom_file_2` VARCHAR(255) NULL,
    `status` INTEGER NOT NULL,
    `created_by` INTEGER NULL,
    `modified_by` INTEGER NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patient_new_cases` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `patient_id` BIGINT NOT NULL,
    `doctor_id` INTEGER NOT NULL,
    `arch_selection` VARCHAR(255) NULL,
    `treatment_specification` VARCHAR(255) NULL,
    `anterior_teeth` VARCHAR(255) NULL,
    `expansion_upper_arch` VARCHAR(255) NULL,
    `expansion_lower_arch` VARCHAR(255) NULL,
    `proclination_upper_arch` VARCHAR(255) NULL,
    `proclination_lower_arch` VARCHAR(255) NULL,
    `ipr_upper_arch` VARCHAR(255) NULL,
    `ipr_lower_arch` VARCHAR(255) NULL,
    `upper_midline` VARCHAR(255) NULL,
    `upper_midline2` VARCHAR(90) NULL,
    `lower_midline` VARCHAR(255) NULL,
    `canine_relationship_left` VARCHAR(255) NULL,
    `canine_relationship_right` VARCHAR(90) NULL,
    `molar_relationship_left` VARCHAR(255) NULL,
    `molar_relationship_right` VARCHAR(90) NULL,
    `Overjet` VARCHAR(255) NULL,
    `Overbite` VARCHAR(255) NULL,
    `posterior_crossbite` VARCHAR(255) NULL,
    `deep_bite` VARCHAR(255) NULL,
    `status` VARCHAR(100) NULL,
    `reason_hold` TEXT NULL,
    `in_transit` ENUM('D', 'I') NULL,
    `ship_id` VARCHAR(200) NULL,
    `ship_detail` TEXT NULL,
    `track_url` VARCHAR(250) NULL,
    `add_instruction` TEXT NULL,
    `add_opinion` TEXT NULL,
    `fav` BOOLEAN NOT NULL DEFAULT false,
    `files` LONGTEXT NULL,
    `links` TEXT NULL,
    `smile_summary` VARCHAR(200) NULL,
    `movement_chart_summary` VARCHAR(255) NULL,
    `comments` LONGTEXT NULL,
    `u_id` VARCHAR(255) NULL,
    `location_id` VARCHAR(200) NULL,
    `communicate_id` VARCHAR(200) NULL,
    `magic_touch_case_id` VARCHAR(255) NULL,
    `order_code` VARCHAR(200) NULL,
    `approved` TINYINT NOT NULL DEFAULT 0,
    `credits` INTEGER NOT NULL DEFAULT 0,
    `files_type` ENUM('medit', '3shape', 'custom') NOT NULL DEFAULT 'custom',
    `complete_status` TINYINT NOT NULL DEFAULT 0,
    `is_archive` TINYINT NOT NULL DEFAULT 0,
    `discount_amount` DOUBLE NOT NULL DEFAULT 0,
    `created_by` INTEGER NULL,
    `modified_by` INTEGER NULL,
    `dm_status` VARCHAR(255) NULL,
    `is_deleted` TINYINT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NULL,
    `approved_date` DATETIME(0) NULL,
    `treatment_start_date` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,
    `encombrement_arcade_maxillaire` VARCHAR(255) NULL,
    `encombrement_arcades_mandibulaire` VARCHAR(255) NULL,
    `expansion_transversale_maxillaire` VARCHAR(255) NULL,
    `expansion_transversale_mandibulaire` VARCHAR(255) NULL,
    `expansion_sagittale_maxillaire` VARCHAR(255) NULL,
    `expansion_sagittale_mandibulaire` VARCHAR(255) NULL,
    `reduction_amelaire_maxillaire` VARCHAR(255) NULL,
    `reduction_amelaire_mandibulaire` VARCHAR(255) NULL,
    `diastemes` VARCHAR(255) NULL,
    `espace_residuel` VARCHAR(255) NULL,
    `espace_residuel_text` TEXT NULL,
    `milieur_inter_incisifs` VARCHAR(255) NULL,
    `deplacer_milieur_superieur` VARCHAR(255) NULL,
    `deplacer_milieu_inferieur` VARCHAR(255) NULL,
    `taquets` VARCHAR(255) NULL,
    `ne_pas_placer_taquets_text` TEXT NULL,
    `instructions_generales` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patients` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `doctor_id` INTEGER NOT NULL,
    `patient_name` VARCHAR(255) NOT NULL,
    `patient_surname` VARCHAR(150) NULL,
    `date_of_birth` VARCHAR(90) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(255) NULL,
    `gender` VARCHAR(255) NULL,
    `consultation_cause` VARCHAR(255) NOT NULL,
    `medit_case_uuid` VARCHAR(255) NULL,
    `country_code` VARCHAR(250) NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `express_single_arch` DOUBLE NOT NULL DEFAULT 0,
    `express_dual_arch` DOUBLE NOT NULL DEFAULT 0,
    `standard_treatment_single_arch` DOUBLE NOT NULL DEFAULT 0,
    `standard_treatment_dual_arch` DOUBLE NOT NULL DEFAULT 0,
    `advanced_treatment_single_arch` DOUBLE NOT NULL DEFAULT 0,
    `advanced_treatment_dual_arch` DOUBLE NOT NULL DEFAULT 0,
    `additional_aligners_single_arch` DOUBLE NOT NULL DEFAULT 0,
    `additional_aligners_dual_arch` DOUBLE NOT NULL DEFAULT 0,
    `retainer_single_arch_1` DOUBLE NOT NULL DEFAULT 0,
    `retainer_single_arch_2` DOUBLE NOT NULL DEFAULT 0,
    `retainer_single_arch_3` DOUBLE NOT NULL DEFAULT 0,
    `dual_arch_1_set_of_retainer` DOUBLE NOT NULL DEFAULT 0,
    `dual_arch_2_sets_of_retainers` DOUBLE NOT NULL DEFAULT 0,
    `dual_arch_3_sets_of_retainers` DOUBLE NOT NULL DEFAULT 0,
    `cancellation_after_design` DOUBLE NOT NULL DEFAULT 0,
    `user_id` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registered_doctors` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `first_name` VARCHAR(255) NOT NULL,
    `last_name` VARCHAR(255) NOT NULL,
    `profile_pic` VARCHAR(255) NULL,
    `user_name` VARCHAR(255) NULL,
    `phone` VARCHAR(255) NULL,
    `office_phone` VARCHAR(50) NULL,
    `speciality` VARCHAR(255) NULL,
    `address` TEXT NULL,
    `address_2` TEXT NULL,
    `city` VARCHAR(255) NULL,
    `subrub` VARCHAR(255) NULL,
    `state` VARCHAR(200) NULL,
    `country` VARCHAR(255) NULL,
    `country_code` VARCHAR(50) NULL,
    `zip` VARCHAR(255) NULL,
    `registered_on` TIMESTAMP(0) NULL,
    `status` INTEGER NULL,
    `magic_touch_id` VARCHAR(255) NULL,
    `medit_name` VARCHAR(255) NULL,
    `medit_phone` VARCHAR(255) NULL,
    `medit_doctor_uuid` VARCHAR(255) NULL,
    `shape_email` VARCHAR(200) NULL,
    `shape_doctor_id` VARCHAR(255) NULL,
    `created_by` INTEGER NULL,
    `modified_by` INTEGER NULL,
    `dm_key` VARCHAR(255) NULL,
    `dm_email` VARCHAR(255) NULL,
    `dm_doctor_id` INTEGER NULL,
    `dm_practice_id` VARCHAR(255) NULL,
    `dm_password` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `password` VARCHAR(255) NOT NULL,
    `last_login` VARCHAR(255) NULL,
    `status` VARCHAR(255) NOT NULL DEFAULT '0',
    `email` VARCHAR(255) NOT NULL,
    `email_verified_at` TIMESTAMP(0) NULL,
    `is_super` INTEGER NOT NULL DEFAULT 0,
    `permission` VARCHAR(90) NULL,
    `grade` VARCHAR(20) NOT NULL DEFAULT 'bronze',
    `admin_verified` TINYINT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `users_email_unique`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
