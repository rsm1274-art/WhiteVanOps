-- Removes the customer-facing public quote-approval link (v2.0 is PDF-only
-- quotes; the operator records the customer's decision manually).

-- DropIndex
DROP INDEX "Quote_publicToken_key";

-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "publicToken";
