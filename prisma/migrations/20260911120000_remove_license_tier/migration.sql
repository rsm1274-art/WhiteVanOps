-- v2.0: Base/Plus tier is removed. Every install runs the full feature set,
-- so the License row's tier column no longer has any meaning.
ALTER TABLE "License" DROP COLUMN "tier";
