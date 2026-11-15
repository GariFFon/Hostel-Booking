-- New enum values for move-out and deposits. They are used only by the next migration (a new value cannot be used in the transaction that adds it).
ALTER TYPE "RentPayMethod" ADD VALUE IF NOT EXISTS 'DEPOSIT';
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'DEPOSIT_HELD';
