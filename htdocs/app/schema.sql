-- Skema IELTS Writing Rater (MySQL 5.7+/8 atau MariaDB 10.3+). Dijalankan otomatis oleh halaman /install.
-- Kolom JSON disimpan sebagai LONGTEXT supaya sama di MySQL dan MariaDB. Waktu disimpan dalam UTC.

CREATE TABLE IF NOT EXISTS `user` (
  `id` char(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `passwordHash` varchar(100) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `writingsession` (
  `id` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `writingBandRaw` double DEFAULT NULL,
  `writingBand` double DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `WritingSession_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `WritingSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `question` (
  `id` char(36) NOT NULL,
  `taskType` enum('task1_academic','task2') NOT NULL,
  `name` varchar(150) NOT NULL,
  `promptText` text NOT NULL,
  `imagePath` varchar(255) DEFAULT NULL,
  `extractedData` longtext DEFAULT NULL,
  `createdById` char(36) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Question_taskType_name_key` (`taskType`, `name`),
  KEY `Question_createdById_fkey` (`createdById`),
  CONSTRAINT `Question_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `submission` (
  `id` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `sessionId` char(36) DEFAULT NULL,
  `taskType` enum('task1_academic','task2') NOT NULL,
  `status` enum('draft','extracted','confirmed','graded') NOT NULL DEFAULT 'draft',
  `promptText` text NOT NULL,
  `promptImagePath` varchar(255) DEFAULT NULL,
  `extractedData` longtext DEFAULT NULL,
  `extractionUncertain` longtext DEFAULT NULL,
  `essayText` text DEFAULT NULL,
  `wordCountTotal` int DEFAULT NULL,
  `wordCountExcluded` int DEFAULT NULL,
  `wordCountCounted` int DEFAULT NULL,
  `factErrors` longtext DEFAULT NULL,
  `gradeResult` longtext DEFAULT NULL,
  `bandTask` int DEFAULT NULL,
  `bandCc` int DEFAULT NULL,
  `bandLr` int DEFAULT NULL,
  `bandGra` int DEFAULT NULL,
  `taskBandRaw` double DEFAULT NULL,
  `taskBand` double DEFAULT NULL,
  `model` varchar(255) DEFAULT NULL,
  `promptVersion` varchar(20) DEFAULT NULL,
  `lastErrorCode` varchar(50) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gradedAt` datetime(3) DEFAULT NULL,
  `questionId` char(36) DEFAULT NULL,
  `pendingState` longtext DEFAULT NULL,
  `studentName` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Submission_sessionId_taskType_key` (`sessionId`, `taskType`),
  KEY `Submission_userId_createdAt_idx` (`userId`, `createdAt`),
  KEY `Submission_userId_studentName_idx` (`userId`, `studentName`),
  KEY `Submission_questionId_fkey` (`questionId`),
  CONSTRAINT `Submission_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `question` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Submission_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `writingsession` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Submission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `polishedversion` (
  `id` char(36) NOT NULL,
  `submissionId` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `targetBand` double NOT NULL,
  `polishedText` text NOT NULL,
  `rescoredResult` longtext NOT NULL,
  `rescoredTaskBand` double NOT NULL,
  `attempts` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `corrections` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `PolishedVersion_submissionId_key` (`submissionId`),
  KEY `PolishedVersion_userId_fkey` (`userId`),
  CONSTRAINT `PolishedVersion_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `submission` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PolishedVersion_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `llmcall` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` char(36) NOT NULL,
  `submissionId` char(36) DEFAULT NULL,
  `action` enum('extract','grade','polish','speaking') NOT NULL,
  `actionId` char(36) NOT NULL,
  `kind` enum('extract','factcheck','grade','polish','rescore','speaking') NOT NULL,
  `model` varchar(255) NOT NULL,
  `inputTokens` int DEFAULT NULL,
  `outputTokens` int DEFAULT NULL,
  `success` tinyint(1) NOT NULL,
  `error` text DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `LlmCall_userId_action_createdAt_idx` (`userId`, `action`, `createdAt`),
  KEY `LlmCall_submissionId_fkey` (`submissionId`),
  CONSTRAINT `LlmCall_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `submission` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `LlmCall_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ujian Speaking. Audio tidak pernah disimpan: hanya transkrip (dibuat di browser) dan nilai.
CREATE TABLE IF NOT EXISTS `speakingtest` (
  `id` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `studentName` varchar(100) DEFAULT NULL,
  `setId` varchar(50) NOT NULL,
  `mode` enum('p1','p2','p3','full') NOT NULL,
  `status` enum('recording','review','final') NOT NULL DEFAULT 'recording',
  `transcripts` longtext DEFAULT NULL,
  `aiResult` longtext DEFAULT NULL,
  `aiBandLr` int DEFAULT NULL,
  `aiBandGra` int DEFAULT NULL,
  `bandLr` int DEFAULT NULL,
  `bandGra` int DEFAULT NULL,
  `bandFc` int DEFAULT NULL,
  `bandPron` int DEFAULT NULL,
  `overallRaw` double DEFAULT NULL,
  `overall` double DEFAULT NULL,
  `examinerComment` text DEFAULT NULL,
  `model` varchar(255) DEFAULT NULL,
  `promptVersion` varchar(20) DEFAULT NULL,
  `lastErrorCode` varchar(50) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `finalizedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `SpeakingTest_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `SpeakingTest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tidak ada tabel pengaturan AI: API key setiap pengguna disimpan di browsernya sendiri.
-- Tabel lama `appsetting` (berisi API key bersama) dihapus oleh upgrade_schema().
