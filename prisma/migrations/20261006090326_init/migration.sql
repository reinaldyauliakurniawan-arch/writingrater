-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WritingSession` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `writingBandRaw` DOUBLE NULL,
    `writingBand` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WritingSession_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Submission` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NULL,
    `taskType` ENUM('task1_academic', 'task2') NOT NULL,
    `status` ENUM('draft', 'extracted', 'confirmed', 'graded') NOT NULL DEFAULT 'draft',
    `promptText` TEXT NOT NULL,
    `promptImagePath` VARCHAR(255) NULL,
    `extractedData` JSON NULL,
    `extractionUncertain` JSON NULL,
    `essayText` TEXT NULL,
    `wordCountTotal` INTEGER NULL,
    `wordCountExcluded` INTEGER NULL,
    `wordCountCounted` INTEGER NULL,
    `factErrors` JSON NULL,
    `gradeResult` JSON NULL,
    `bandTask` INTEGER NULL,
    `bandCc` INTEGER NULL,
    `bandLr` INTEGER NULL,
    `bandGra` INTEGER NULL,
    `taskBandRaw` DOUBLE NULL,
    `taskBand` DOUBLE NULL,
    `model` VARCHAR(255) NULL,
    `promptVersion` VARCHAR(20) NULL,
    `lastErrorCode` VARCHAR(50) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `gradedAt` DATETIME(3) NULL,

    INDEX `Submission_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `Submission_sessionId_taskType_key`(`sessionId`, `taskType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PolishedVersion` (
    `id` CHAR(36) NOT NULL,
    `submissionId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `targetBand` DOUBLE NOT NULL,
    `polishedText` TEXT NOT NULL,
    `rescoredResult` JSON NOT NULL,
    `rescoredTaskBand` DOUBLE NOT NULL,
    `attempts` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PolishedVersion_submissionId_key`(`submissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LlmCall` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `submissionId` CHAR(36) NULL,
    `action` ENUM('extract', 'grade', 'polish') NOT NULL,
    `actionId` CHAR(36) NOT NULL,
    `kind` ENUM('extract', 'factcheck', 'grade', 'polish', 'rescore') NOT NULL,
    `model` VARCHAR(255) NOT NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `success` BOOLEAN NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LlmCall_userId_action_createdAt_idx`(`userId`, `action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `provider` ENUM('anthropic', 'openai', 'google', 'openai_compatible') NOT NULL,
    `model` VARCHAR(200) NOT NULL,
    `baseUrl` VARCHAR(500) NULL,
    `apiKeyEncrypted` TEXT NULL,
    `apiKeyLast4` VARCHAR(4) NULL,
    `dailyLimitGrade` INTEGER NOT NULL DEFAULT 10,
    `dailyLimitPolish` INTEGER NOT NULL DEFAULT 5,
    `dailyLimitExtract` INTEGER NOT NULL DEFAULT 10,
    `lastTestOk` BOOLEAN NULL,
    `lastTestAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WritingSession` ADD CONSTRAINT `WritingSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `WritingSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PolishedVersion` ADD CONSTRAINT `PolishedVersion_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PolishedVersion` ADD CONSTRAINT `PolishedVersion_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LlmCall` ADD CONSTRAINT `LlmCall_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LlmCall` ADD CONSTRAINT `LlmCall_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
