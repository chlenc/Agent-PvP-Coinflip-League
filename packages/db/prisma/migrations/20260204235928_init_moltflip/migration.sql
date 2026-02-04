-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mint" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "creatorPubkey" TEXT NOT NULL,
    "joinerPubkey" TEXT,
    "winnerPubkey" TEXT,
    "creatorDepositTx" TEXT,
    "joinerDepositTx" TEXT,
    "settleTx" TEXT,
    "serverSeed" TEXT,
    "serverFlip" INTEGER
);
